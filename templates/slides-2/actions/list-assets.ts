import { defineAction } from "@agent-native/core";
import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { collectSlideAssetIds } from "../server/lib/slide-source.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import { readStoredSlideSource } from "./_slide-source.js";

const assetListSchema = z
  .preprocess(
    (value) => (value === undefined ? {} : value),
    z.object({
      scope: z
        .enum(["slide", "deck", "global"])
        .default("global")
        .describe(
          'Asset collection: "slide" for assets referenced by one slide, "deck" for its full catalog, or "global"; defaults to "global"',
        ),
      media: z
        .enum(["image", "video", "all"])
        .default("image")
        .describe(
          'Media type: "image", supported "video" (MP4 or WebM), or "all"; defaults to "image" for existing image-library callers',
        ),
      deckId: z
        .string()
        .min(1)
        .optional()
        .describe('Deck ID, required when scope is "slide" or "deck"'),
      slideId: z
        .string()
        .min(1)
        .optional()
        .describe('Slide ID, required when scope is "slide"'),
    }),
  )
  .superRefine(({ scope, deckId, slideId }, context) => {
    if ((scope === "deck" || scope === "slide") && !deckId) {
      context.addIssue({
        code: "custom",
        message: "Deck and slide scopes require deckId.",
      });
    }
    if (scope === "slide" && !slideId) {
      context.addIssue({
        code: "custom",
        message: "Slide scope requires slideId.",
      });
    }
    if (scope !== "slide" && slideId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only slide scope accepts slideId.",
      });
    }
    if (scope === "global" && deckId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Global scope does not accept deckId.",
      });
    }
  });

function imageAssetWorkspaceScope(orgId: string | null | undefined) {
  if (!orgId) return isNull(schema.uploadedAssets.orgId);
  return or(
    eq(schema.uploadedAssets.orgId, orgId),
    isNull(schema.uploadedAssets.orgId),
  );
}

function assetScopeForDeck(ownerEmail: string, orgId: string | null) {
  const ownerScope = and(
    eq(schema.uploadedAssets.ownerEmail, ownerEmail),
    orgId
      ? eq(schema.uploadedAssets.orgId, orgId)
      : isNull(schema.uploadedAssets.orgId),
  );
  return orgId
    ? or(ownerScope, eq(schema.uploadedAssets.orgId, orgId))
    : ownerScope;
}

function requireSlideId(slideId: string | undefined): string {
  if (!slideId) {
    fail("Slide scope requires slideId.", {
      errorCode: "asset_deck_scope_invalid",
      statusCode: 400,
    });
  }
  return slideId;
}

export default defineAction({
  title: "List uploaded media",
  description:
    "List uploaded images or supported MP4/WebM videos referenced by one accessible slide, from its full deck catalog, or from the global collection. Slide scope requires deckId and slideId. Defaults to images for existing image-library callers.",
  schema: assetListSchema,
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ scope, media, deckId, slideId }) => {
    const slideScope =
      scope === "slide" ? { slideId: requireSlideId(slideId) } : null;
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch {
      fail("Could not load uploaded images.", {
        errorCode: "asset_list_failed",
        statusCode: 500,
      });
    }
    const requestedMedia = media ?? "image";
    const mediaFilter =
      requestedMedia === "image"
        ? like(schema.uploadedAssets.type, "image/%")
        : requestedMedia === "video"
          ? or(
              eq(schema.uploadedAssets.type, "video/mp4"),
              eq(schema.uploadedAssets.type, "video/webm"),
            )
          : or(
              like(schema.uploadedAssets.type, "image/%"),
              eq(schema.uploadedAssets.type, "video/mp4"),
              eq(schema.uploadedAssets.type, "video/webm"),
            );
    const filters = [mediaFilter];

    if (scope === "deck" || scope === "slide") {
      if (!deckId) {
        fail("Deck scope requires deckId.", {
          errorCode: "asset_deck_scope_invalid",
          statusCode: 400,
        });
      }
      if (scope === "deck") {
        filters.push(eq(schema.uploadedAssets.deckId, deckId));
      }
      try {
        await assertAccess("deck", deckId, "editor");
      } catch (error) {
        if ((error as { statusCode?: unknown })?.statusCode === 403) {
          fail("You don't have access to this presentation's images.", {
            errorCode: "asset_deck_access_denied",
            statusCode: 403,
          });
        }
        if ((error as { statusCode?: unknown })?.statusCode === 404) {
          fail("Deck not found.", {
            errorCode: "deck_not_found",
            statusCode: 404,
          });
        }
        fail("Could not verify access to this presentation.", {
          errorCode: "asset_list_failed",
          statusCode: 500,
        });
      }
      let deckRows: Array<{
        data: string;
        ownerEmail: string;
        orgId: string | null;
      }>;
      try {
        deckRows = await db
          .select({
            data: schema.decks.data,
            ownerEmail: schema.decks.ownerEmail,
            orgId: schema.decks.orgId,
          })
          .from(schema.decks)
          .where(eq(schema.decks.id, deckId))
          .limit(1);
      } catch {
        fail("Could not load uploaded images.", {
          errorCode: "asset_list_failed",
          statusCode: 500,
        });
      }
      const [deckRow] = deckRows;
      if (!deckRow) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }

      let deck: unknown;
      let slideSource: string | undefined;
      if (slideScope) {
        const snapshot = readStoredSlideSource(
          deckRow.data,
          slideScope.slideId,
        );
        deck = snapshot.data;
        slideSource = snapshot.slide.sourceTsx;
      } else {
        try {
          deck = JSON.parse(deckRow.data);
        } catch {
          fail("Deck data is invalid.", {
            errorCode: "invalid_deck_data",
            statusCode: 500,
          });
        }
      }
      assertSlides2DeckData(deck);
      if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
        fail("Deck data is invalid.", {
          errorCode: "invalid_deck_data",
          statusCode: 500,
        });
      }
      if (slideScope) {
        if (typeof slideSource !== "string") {
          fail("Could not load uploaded images.", {
            errorCode: "asset_list_failed",
            statusCode: 500,
          });
        }
        let referencedAssetIds: string[];
        try {
          referencedAssetIds = collectSlideAssetIds(slideSource);
        } catch {
          fail("Could not load uploaded images.", {
            errorCode: "asset_list_failed",
            statusCode: 500,
          });
        }
        if (referencedAssetIds.length === 0) return [];
        filters.push(inArray(schema.uploadedAssets.id, referencedAssetIds));
      }
      filters.push(assetScopeForDeck(deckRow.ownerEmail, deckRow.orgId));
    } else {
      filters.push(isNull(schema.uploadedAssets.deckId));
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) {
        fail("Sign in to view uploaded images.", {
          errorCode: "asset_list_auth_required",
          statusCode: 401,
        });
      }
      filters.push(
        eq(schema.uploadedAssets.ownerEmail, ownerEmail),
        imageAssetWorkspaceScope(getRequestOrgId()),
      );
    }

    try {
      return await db
        .select({
          id: schema.uploadedAssets.id,
          url: schema.uploadedAssets.url,
          filename: schema.uploadedAssets.filename,
          type: schema.uploadedAssets.type,
          size: schema.uploadedAssets.size,
          createdAt: schema.uploadedAssets.createdAt,
        })
        .from(schema.uploadedAssets)
        .where(and(...filters))
        .orderBy(desc(schema.uploadedAssets.createdAt));
    } catch {
      fail("Could not load uploaded images.", {
        errorCode: "asset_list_failed",
        statusCode: 500,
      });
    }
  },
});
