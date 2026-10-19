import { createHash } from "node:crypto";

import { fail } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { repairDeckSlideReferences } from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import { assertSlides2DeckData, isSlides2DeckData } from "./_deck-app-scope.js";
import { trackDeckCreated } from "./_deck-tracking.js";
import { assertDeckInlineImagesPersistable } from "./_render-artifacts.js";

function requestHash(input: {
  deckId: string;
  title: string | undefined;
  slideIds: string[] | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        deckId: input.deckId,
        title: input.title ?? null,
        slideIds: input.slideIds ?? null,
      }),
    )
    .digest("hex");
}

function duplicateIdConflict(): never {
  fail(
    "This copy ID is already in use for a different request. Choose a new ID.",
    {
      errorCode: "deck_copy_id_conflict",
      statusCode: 409,
    },
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function readDuplicateCopy(
  id: string,
  ownerEmail: string,
  orgId: string | null,
  sourceDeckId: string,
  hash: string,
) {
  const access = await resolveAccess("deck", id);
  if (!access) return null;

  const resource = access.resource;
  if (
    resource.ownerEmail?.toLowerCase() !== ownerEmail.toLowerCase() ||
    (resource.orgId ?? null) !== orgId ||
    !isSlides2DeckData(resource.data)
  ) {
    duplicateIdConflict();
  }

  let data: unknown;
  try {
    data = JSON.parse(resource.data);
  } catch {
    duplicateIdConflict();
  }
  const copy = data as {
    id?: unknown;
    duplicateRequest?: { sourceDeckId?: unknown; hash?: unknown };
    slides?: unknown;
  };
  if (
    copy.duplicateRequest?.sourceDeckId !== sourceDeckId ||
    copy.duplicateRequest?.hash !== hash ||
    copy.id !== id ||
    typeof resource.title !== "string" ||
    !Array.isArray(copy.slides)
  ) {
    duplicateIdConflict();
  }

  return {
    id,
    title: resource.title,
    slideCount: copy.slides.length,
    url: getDeckUrl(id),
    appUrl: getDeckUrl(id),
  };
}

export default defineAction({
  description:
    "Duplicate an accessible deck with fresh slide IDs and return its ID, title, and slide count; supplying newId makes the same deckId/title/slideIds request safely retryable without overwriting later edits.",
  schema: z.object({
    deckId: z.string().min(1).describe("Source deck ID to duplicate"),
    title: z
      .string()
      .optional()
      .describe("Title for the copy (defaults to 'Copy of ...')"),
    newId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
      .describe(
        "Optional stable ID for the copy. Reusing it with the same deckId, title, and slideIds returns the existing copy without overwriting later edits; use a new ID for a different request.",
      ),
    slideIds: z
      .array(z.string().min(1).max(64))
      .max(1000)
      .optional()
      .describe(
        "Optional client-supplied IDs for the copied slides, in slide order; provide exactly one ID per source slide. When the UI opens an optimistic copy, these IDs keep immediate edits aligned with the persisted copy.",
      ),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  retrySafe: (input) => typeof input.newId === "string",
  run: async ({ deckId, title, newId: clientNewId, slideIds }, ctx) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Authentication is required.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() ?? null;
    const newId = clientNewId ?? `deck-${nanoid()}`;
    const hash = requestHash({ deckId, title, slideIds });

    if (clientNewId) {
      const existing = await readDuplicateCopy(
        newId,
        ownerEmail,
        orgId,
        deckId,
        hash,
      );
      if (existing) return { ...existing, reused: true };
    }

    const access = await resolveAccess("deck", deckId);
    if (!access) {
      fail("Deck not found.", {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }

    const source = access.resource;
    const db = getDb();
    const now = new Date().toISOString();
    let deckData: Record<string, unknown>;
    try {
      deckData = JSON.parse(source.data);
    } catch {
      fail("The source deck data could not be read.", {
        errorCode: "invalid_deck_data",
        statusCode: 422,
      });
    }
    assertSlides2DeckData(deckData);

    const rawSlides = deckData.slides;
    if (
      !Array.isArray(rawSlides) ||
      rawSlides.some(
        (slide: unknown) =>
          !slide || typeof slide !== "object" || Array.isArray(slide),
      )
    ) {
      fail("The source deck data has an invalid slide list.", {
        errorCode: "invalid_deck_data",
        statusCode: 422,
      });
    }
    const slides = rawSlides as Array<{ id?: unknown }>;
    if (slideIds && slideIds.length !== slides.length) {
      fail("Provide one slide ID for each slide in the source deck.", {
        errorCode: "invalid_slide_ids",
        statusCode: 400,
      });
    }
    const originalSlideIds = slides.map((slide: { id?: unknown }) =>
      typeof slide.id === "string" ? slide.id : null,
    );
    const assignedSlideIds = slides.map((slide, index) => {
      const id = slideIds?.[index] ?? `slide-${nanoid(8)}`;
      slide.id = id;
      return id;
    });
    if (new Set(assignedSlideIds).size !== slides.length) {
      fail("Slide IDs must be unique.", {
        errorCode: "invalid_slide_ids",
        statusCode: 400,
      });
    }

    const newTitle = title || `Copy of ${source.title}`;
    Object.assign(
      deckData,
      repairDeckSlideReferences(deckData, slides, originalSlideIds),
    );
    deckData.title = newTitle;
    deckData.id = newId;
    deckData.createdAt = now;
    deckData.updatedAt = now;
    deckData.appId = "slides-2";
    deckData.designSystemId = source.designSystemId ?? deckData.designSystemId;
    deckData.visibility = "private";
    delete deckData.shareToken;
    deckData.duplicateRequest = { sourceDeckId: deckId, hash };
    assertDeckInlineImagesPersistable(null, deckData);

    try {
      await db.insert(schema.decks).values({
        id: newId,
        title: newTitle,
        data: JSON.stringify(deckData),
        designSystemId: source.designSystemId ?? null,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
        ownerEmail,
        orgId,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await readDuplicateCopy(
        newId,
        ownerEmail,
        orgId,
        deckId,
        hash,
      );
      if (existing) return { ...existing, reused: true };
      duplicateIdConflict();
    }

    trackDeckCreated(
      newId,
      {
        creationMethod: "duplicate",
        purpose: "direct",
        slideCount: slides.length,
      },
      ctx,
    );

    const persisted = await readDuplicateCopy(
      newId,
      ownerEmail,
      orgId,
      deckId,
      hash,
    );
    if (!persisted) {
      fail("The duplicate was created but could not be read back.", {
        errorCode: "deck_copy_readback_failed",
        statusCode: 503,
      });
    }

    return {
      ...persisted,
      reused: false,
    };
  },
});
