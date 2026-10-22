import { defineAction } from "@agent-native/core";
import { fail, isActionContractError } from "@agent-native/core/action";
import type { ActionRunContext, WriteReceipt } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChatContextFromAction,
} from "../server/lib/deck-versions.js";
import { lockSlideAssetReferences } from "../server/lib/slide-asset-references.js";
import { applyEditBatch } from "../server/lib/slide-source-editing/batch-edit.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "../server/lib/slide-source-limits.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { assertNoDeckRenderArtifacts } from "./_render-artifacts.js";
import {
  compileSlideSource,
  readStoredSlideSource,
  slideSourceEditsSchema,
} from "./_slide-source.js";
import { withDeckLock } from "./patch-deck.js";

function rethrowActionFailure(error: unknown): never {
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

export default defineAction({
  title: "Update slide source",
  description:
    "Atomically edit one saved slide's React source using source-located operations or a full source replacement. Pass the revision and SHA-256 source hash from get-slide-source. Replaying a full replacement returns a verified no-op when that exact source and preview are already saved; after any other conflict, read the source again and reconcile before retrying edits. The source is validated, rendered to a script-free home preview, and saved with a new revision in SQL.",
  schema: z
    .object({
      deckId: z.string().min(1).describe("Deck containing the slide"),
      slideId: z.string().min(1).describe("Stable slide ID to update"),
      expectedRevision: z
        .number()
        .int()
        .positive()
        .describe("Current slide revision from get-slide-source"),
      expectedSourceHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .describe("Current SHA-256 source hash from get-slide-source"),
      sourceTsx: z
        .string()
        .max(MAX_SLIDE_SOURCE_BYTES)
        .refine(isSlideSourceWithinByteLimit, {
          message: SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
        })
        .optional()
        .describe(
          "Complete replacement React component source; use for restore or broad rewrite",
        ),
      edits: slideSourceEditsSchema
        .optional()
        .describe(
          "Atomic source-located changes; every operation must succeed for the batch to save",
        ),
    })
    .superRefine(({ sourceTsx, edits }, context) => {
      if ((sourceTsx === undefined) === (edits === undefined)) {
        context.addIssue({
          code: "custom",
          path: ["sourceTsx"],
          message: "Pass exactly one of sourceTsx or edits.",
        });
      }
    }),
  retrySafe: true,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (
    { deckId, slideId, expectedRevision, expectedSourceHash, sourceTsx, edits },
    ctx?: ActionRunContext,
  ) =>
    withDeckLock(deckId, async () => {
      await assertAccess("deck", deckId, "editor");
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (!row) {
        fail("Deck not found.", {
          statusCode: 404,
          errorCode: "deck_not_found",
        });
      }
      let snapshot: ReturnType<typeof readStoredSlideSource>;
      try {
        snapshot = readStoredSlideSource(row.data, slideId);
      } catch (error) {
        rethrowActionFailure(error);
      }
      assertSlides2DeckData(snapshot.data);
      const expectedSourceIsStale =
        snapshot.revision !== expectedRevision ||
        snapshot.sourceHash !== expectedSourceHash;
      if (
        expectedSourceIsStale &&
        (sourceTsx === undefined || sourceTsx !== snapshot.slide.sourceTsx)
      ) {
        fail("Slide source changed while you were editing it.", {
          statusCode: 409,
          errorCode: "slide_source_conflict",
          details: {
            revision: snapshot.revision,
            sourceHash: snapshot.sourceHash,
          },
        });
      }

      let nextSource = sourceTsx;
      let editResults: Array<{ ok: boolean; error?: string }> = [];
      if (edits) {
        const batch = applyEditBatch(snapshot.slide.sourceTsx, edits);
        editResults = batch.results;
        const failed = batch.results.flatMap((result, index) =>
          result.ok ? [] : [{ index, error: result.error ?? "edit failed" }],
        );
        if (failed.length > 0) {
          fail(
            "No source edits were saved because one or more operations failed.",
            {
              statusCode: 422,
              errorCode: "slide_source_edit_failed",
              details: { results: batch.results, failed },
            },
          );
        }
        nextSource = batch.source;
      }
      if (typeof nextSource !== "string") {
        fail("A source update is required.", {
          statusCode: 400,
          errorCode: "slide_source_missing",
        });
      }

      let compiled: Awaited<ReturnType<typeof compileSlideSource>>;
      try {
        compiled = await compileSlideSource(nextSource, {
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
        });
      } catch (error) {
        rethrowActionFailure(error);
      }
      if (
        nextSource === snapshot.slide.sourceTsx &&
        compiled.content === snapshot.slide.content
      ) {
        const _receipt: WriteReceipt = {
          changed: false,
          verified: true,
          summary: "Slide source already matches the requested content.",
          subject: `${deckId}:${slideId}`,
          checks: [
            {
              id: "slide-source",
              ok: true,
              detail: `Revision ${snapshot.revision} already matches the requested source.`,
            },
          ],
        };
        return {
          deckId,
          slideId,
          position: snapshot.position,
          previousRevision: snapshot.revision,
          revision: snapshot.revision,
          sourceHash: snapshot.sourceHash,
          sourceTsx: snapshot.slide.sourceTsx,
          results: editResults,
          notificationStatus: "not_needed" as const,
          _receipt,
        };
      }
      const nextRevision = snapshot.revision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        fail("Slide source revision cannot be advanced safely.", {
          statusCode: 409,
          errorCode: "slide_source_revision_exhausted",
        });
      }
      const nextData = {
        ...snapshot.data,
        slides: [...(snapshot.data.slides as Array<Record<string, unknown>>)],
        updatedAt: nextDeckRevision(row.updatedAt),
      };
      const nextSlide = {
        ...snapshot.slide,
        sourceTsx: nextSource,
        revision: nextRevision,
        sourceHash: compiled.sourceHash,
        content: compiled.content,
      };
      (nextData.slides as Array<Record<string, unknown>>)[snapshot.position] =
        nextSlide;
      if (Object.hasOwn(nextData, "sourceImport")) {
        delete (nextData as Record<string, unknown>).sourceImport;
      }
      assertNoDeckRenderArtifacts(row.data, nextData);
      const persistedData = JSON.stringify(nextData);

      try {
        await db.transaction(async (tx: any) => {
          await lockSlideAssetReferences(
            tx,
            nextData,
            {
              ownerEmail: row.ownerEmail,
              orgId: row.orgId,
            },
            deckId,
          );
          await createDeckVersionSnapshot(
            {
              id: row.id,
              title: row.title,
              data: row.data,
              ownerEmail: row.ownerEmail,
            },
            {
              label: "Before editing slide source",
              chatContext: deckVersionChatContextFromAction(ctx),
              db: tx,
            },
          );
          const updatedRows = await tx
            .update(schema.decks)
            .set({
              data: persistedData,
              updatedAt: nextData.updatedAt,
            })
            .where(
              and(
                eq(schema.decks.data, row.data),
                deckRevisionWhere(schema.decks, deckId, row.updatedAt),
              ),
            )
            .returning({
              id: schema.decks.id,
              data: schema.decks.data,
              updatedAt: schema.decks.updatedAt,
            });
          assertDeckWriteApplied(
            { rowsAffected: updatedRows.length },
            deckId,
            "slide source update",
          );
          const persisted = updatedRows[0];
          if (
            persisted?.id !== deckId ||
            persisted.data !== persistedData ||
            persisted.updatedAt !== nextData.updatedAt
          ) {
            fail("Database did not return the expected saved slide source.", {
              statusCode: 503,
              errorCode: "deck_persistence_unverified",
              details: { deckId, slideId, revision: nextRevision },
            });
          }
        });
      } catch (error) {
        rethrowActionFailure(error);
      }

      let notificationStatus: "sent" | "failed" = "sent";
      let notificationErrorType: string | undefined;
      try {
        await notifyClients(deckId, { slideId });
      } catch (error) {
        notificationStatus = "failed";
        notificationErrorType =
          error instanceof Error ? error.name : "UnknownError";
      }
      const _receipt: WriteReceipt = {
        changed: true,
        verified: true,
        summary: `Saved slide source at revision ${nextRevision}.`,
        subject: `${deckId}:${slideId}`,
        checks: [
          {
            id: "slide-source",
            ok: true,
            detail: `Saved revision ${nextRevision} with source hash ${compiled.sourceHash}.`,
          },
        ],
        ...(notificationStatus === "failed"
          ? {
              warnings: [
                "The slide source save succeeded, but live client notification failed.",
              ],
            }
          : {}),
      };
      return {
        deckId,
        slideId,
        position: snapshot.position,
        previousRevision: snapshot.revision,
        revision: nextRevision,
        sourceHash: compiled.sourceHash,
        sourceTsx: nextSource,
        results: editResults,
        notificationStatus,
        nextRequiredAction: "get-slide-source",
        ...(notificationErrorType ? { notificationErrorType } : {}),
        _receipt,
      };
    }),
});
