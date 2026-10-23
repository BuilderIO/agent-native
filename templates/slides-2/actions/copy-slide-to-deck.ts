import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "../server/lib/slide-source-limits.js";
import { hashSlideSource } from "../server/lib/slide-source.js";
import { ANIMATION_TRIGGERS } from "../shared/api.js";
import {
  SLIDE_TRANSITION_INPUTS,
  SLIDE_TRANSITION_SPEED,
} from "../shared/slide-transitions.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  canReadPresenterNotes,
  redactPresenterNotes,
} from "./_presenter-notes.js";
import type { DeckReadAccessRole } from "./_presenter-notes.js";
import { readStoredSlideSource } from "./_slide-source.js";
import type { Operation } from "./patch-deck.js";
import patchDeck from "./patch-deck.js";

const CopiedSlideFieldsSchema = z
  .object({
    content: z.string().optional(),
    sourceTsx: z
      .string()
      .max(MAX_SLIDE_SOURCE_BYTES)
      .refine(isSlideSourceWithinByteLimit, {
        message: SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
      })
      .optional(),
    notes: z.string().optional(),
    layout: z.string().optional(),
    background: z.string().optional(),
    imageUrl: z.string().optional(),
    imagePrompt: z.string().optional(),
    excalidrawData: z.string().optional(),
    transition: z.enum(SLIDE_TRANSITION_INPUTS).nullable().optional(),
    transitionSpeed: z
      .number()
      .int()
      .min(SLIDE_TRANSITION_SPEED.min)
      .max(SLIDE_TRANSITION_SPEED.max)
      .nullable()
      .optional(),
    animations: z
      .array(
        z.object({
          id: z.string().min(1),
          elementIndex: z.number().int().min(0),
          elementPath: z.array(z.number().int().min(0)).min(1).optional(),
          byParagraph: z.boolean().optional(),
          trigger: z.enum(ANIMATION_TRIGGERS).optional(),
          type: z.enum(["appear", "fade", "slide-up", "zoom"]),
        }),
      )
      .nullable()
      .optional(),
    splitByParagraph: z.boolean().optional(),
    skipped: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((fields, context) => {
    if ((fields.content === undefined) === (fields.sourceTsx === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceTsx"],
        message: "A copied slide must contain exactly one source format.",
      });
    }
  });

type StoredDeckRow = {
  id: string;
  data: string;
};

function rethrowSlideSourceFailure(error: unknown): never {
  if (isActionContractError(error)) throw error;
  if (!(error instanceof Error)) throw error;
  const failure = error as Error & {
    statusCode?: unknown;
    errorCode?: unknown;
    details?: unknown;
  };
  if (
    typeof failure.statusCode !== "number" ||
    typeof failure.errorCode !== "string"
  ) {
    throw error;
  }
  const details =
    failure.details &&
    typeof failure.details === "object" &&
    !Array.isArray(failure.details)
      ? (failure.details as Record<string, unknown>)
      : undefined;
  fail(error.message, {
    statusCode: failure.statusCode,
    errorCode: failure.errorCode,
    ...(details ? { details } : {}),
  });
}

function invalidSourceDeck(): never {
  fail("The source deck data could not be read.", {
    errorCode: "invalid_deck_data",
    statusCode: 500,
  });
}

function copyFields(
  slide: Record<string, unknown>,
  canReadNotes: boolean,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const stringFields = [
    "background",
    "layout",
    "imageUrl",
    "imagePrompt",
    "excalidrawData",
  ] as const;
  for (const field of stringFields) {
    if (!Object.hasOwn(slide, field) || slide[field] === null) continue;
    fields[field] = slide[field];
  }

  for (const field of [
    "transition",
    "transitionSpeed",
    "animations",
  ] as const) {
    if (Object.hasOwn(slide, field)) fields[field] = slide[field];
  }
  for (const field of ["splitByParagraph", "skipped"] as const) {
    if (!Object.hasOwn(slide, field) || slide[field] === null) continue;
    fields[field] = slide[field];
  }
  if (canReadNotes && Object.hasOwn(slide, "notes")) {
    fields.notes = slide.notes;
  }
  return fields;
}

function findSourceSlide(
  deckData: Record<string, unknown>,
  sourceSlideId: string,
): Record<string, unknown> {
  if (!Array.isArray(deckData.slides)) invalidSourceDeck();
  const matches = deckData.slides.filter(
    (slide): slide is Record<string, unknown> =>
      !!slide &&
      typeof slide === "object" &&
      !Array.isArray(slide) &&
      (slide as Record<string, unknown>).id === sourceSlideId,
  );
  if (matches.length > 1) {
    fail("The source deck contains duplicate slide IDs.", {
      errorCode: "duplicate_deck_slide_ids",
      statusCode: 409,
      details: { slideId: sourceSlideId },
    });
  }
  const slide = matches[0];
  if (!slide) {
    fail(`Slide not found: ${sourceSlideId}`, {
      errorCode: "slide_not_found",
      statusCode: 404,
      details: { slideId: sourceSlideId },
    });
  }
  return slide;
}

function buildAddSlideOperation(input: {
  slide: Record<string, unknown>;
  sourceDeckData: string;
  sourceSlideId: string;
  sourceRole: DeckReadAccessRole;
  targetSlideId: string;
  afterSlideId?: string;
}): Extract<Operation, { op: "add-slide" }> {
  const { slide, sourceRole } = input;
  let copyableSlide = slide;
  const hasSource = Object.hasOwn(slide, "sourceTsx");

  if (hasSource) {
    let verifiedSlide: Record<string, unknown>;
    try {
      verifiedSlide = readStoredSlideSource(
        input.sourceDeckData,
        input.sourceSlideId,
      ).slide;
    } catch (error) {
      rethrowSlideSourceFailure(error);
    }
    copyableSlide = verifiedSlide;
    if (!canReadPresenterNotes(sourceRole)) {
      const redacted = redactPresenterNotes(copyableSlide);
      if (
        !redacted ||
        typeof redacted !== "object" ||
        Array.isArray(redacted) ||
        typeof (redacted as Record<string, unknown>).sourceTsx !== "string"
      ) {
        fail("Presenter notes could not be safely removed from this slide.", {
          errorCode: "slide_source_notes_redaction_failed",
          statusCode: 403,
          details: { slideId: input.sourceSlideId },
        });
      }
      copyableSlide = redacted as Record<string, unknown>;
    }
  } else if (Object.hasOwn(slide, "content")) {
    if (typeof slide.content !== "string") {
      fail("The source slide content is invalid.", {
        errorCode: "invalid_slide_data",
        statusCode: 409,
        details: { slideId: input.sourceSlideId },
      });
    }
  } else {
    fail("The source slide has no content that can be copied.", {
      errorCode: "invalid_slide_data",
      statusCode: 409,
      details: { slideId: input.sourceSlideId },
    });
  }

  const unvalidatedFields = copyFields(
    copyableSlide,
    canReadPresenterNotes(sourceRole),
  );
  if (typeof copyableSlide.sourceTsx === "string") {
    unvalidatedFields.sourceTsx = copyableSlide.sourceTsx;
  } else {
    unvalidatedFields.content = copyableSlide.content;
  }

  const parsed = CopiedSlideFieldsSchema.safeParse(unvalidatedFields);
  if (!parsed.success) {
    fail("The source slide contains unsupported or invalid slide data.", {
      errorCode: "slide_copy_data_invalid",
      statusCode: 409,
      details: {
        slideId: input.sourceSlideId,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    });
  }
  return {
    op: "add-slide",
    slideId: input.targetSlideId,
    ...(input.afterSlideId ? { afterSlideId: input.afterSlideId } : {}),
    fields: parsed.data,
  };
}

export default defineAction({
  title: "Copy slide to deck",
  description:
    "Copy one slide from a deck the caller can view into a deck they can edit. Returns the new slide ID and updated deck revision.",
  schema: z.object({
    sourceDeckId: z.string().min(1).describe("Deck that contains the slide"),
    sourceSlideId: z.string().min(1).describe("Slide to copy"),
    targetDeckId: z.string().min(1).describe("Editable destination deck"),
    slideId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .describe("New stable ID for the copied slide"),
    afterSlideId: z
      .string()
      .min(1)
      .optional()
      .describe("Destination slide to insert after; omit to append"),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  retrySafe: false,
  run: async (
    { sourceDeckId, sourceSlideId, targetDeckId, slideId, afterSlideId },
    ctx?: ActionRunContext,
  ) => {
    if (sourceDeckId === targetDeckId) {
      fail("Choose a different destination deck to copy this slide.", {
        errorCode: "cross_deck_copy_required",
        statusCode: 400,
      });
    }

    const sourceAccess = await assertAccess("deck", sourceDeckId, "viewer");
    await assertAccess("deck", targetDeckId, "editor");

    const [sourceRow] = (await getDb()
      .select({ id: schema.decks.id, data: schema.decks.data })
      .from(schema.decks)
      .where(eq(schema.decks.id, sourceDeckId))
      .limit(1)) as StoredDeckRow[];
    if (!sourceRow) {
      fail("The source deck could not be found.", {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }

    let sourceDeckDataObject: Record<string, unknown>;
    try {
      const parsedData: unknown = JSON.parse(sourceRow.data);
      if (
        !parsedData ||
        typeof parsedData !== "object" ||
        Array.isArray(parsedData)
      ) {
        invalidSourceDeck();
      }
      sourceDeckDataObject = parsedData as Record<string, unknown>;
    } catch (error) {
      if (isActionContractError(error)) throw error;
      invalidSourceDeck();
    }
    assertSlides2DeckData(sourceDeckDataObject);
    const sourceSlide = findSourceSlide(sourceDeckDataObject, sourceSlideId);
    const operation = buildAddSlideOperation({
      slide: sourceSlide,
      sourceDeckData: sourceRow.data,
      sourceSlideId,
      sourceRole: sourceAccess.role,
      targetSlideId: slideId,
      ...(afterSlideId ? { afterSlideId } : {}),
    });

    const result = await patchDeck.run(
      { deckId: targetDeckId, operations: [operation] },
      ctx,
    );
    const patchResult = result as {
      ok?: unknown;
      updatedAt?: unknown;
      updatedSlideIds?: unknown;
    } | null;
    const updatedAt = patchResult?.updatedAt;
    if (
      !patchResult ||
      patchResult.ok !== true ||
      typeof updatedAt !== "string" ||
      !Array.isArray(patchResult.updatedSlideIds) ||
      !patchResult.updatedSlideIds.includes(slideId)
    ) {
      fail("The slide was not copied into the destination deck.", {
        errorCode: "slide_copy_not_applied",
        statusCode: 409,
        details: { targetDeckId, slideId },
      });
    }
    return {
      deckId: targetDeckId,
      slideId,
      updatedAt,
      updatedSlideIds: [slideId],
      ...(typeof operation.fields.sourceTsx === "string"
        ? {
            revision: 1,
            sourceHash: hashSlideSource(operation.fields.sourceTsx),
          }
        : {}),
    };
  },
});
