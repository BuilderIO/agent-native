import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
  deckVersionContentSignature,
} from "../server/lib/deck-versions.js";
import { lockSlideAssetReferences } from "../server/lib/slide-asset-references.js";
import { getDeckUrl } from "./_app-url.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { assertDeckInlineImagesPersistable } from "./_render-artifacts.js";
import { readStoredSlideSource } from "./_slide-source.js";
import { isAgentPatchCaller } from "./patch-deck.js";

function rethrowSlideSourceFailure(error: unknown): never {
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

function reconcileRestoredSourceRevisions(
  currentDataJson: string,
  restoredData: Record<string, unknown>,
  restoredUpdatedAt: string,
): void {
  if (!Array.isArray(restoredData.slides)) return;

  let currentData: Record<string, unknown>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(currentDataJson);
  } catch {
    fail("Current deck data could not be read for source revision checks.", {
      statusCode: 500,
      errorCode: "invalid_deck_data",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Current deck data could not be read for source revision checks.", {
      statusCode: 500,
      errorCode: "invalid_deck_data",
    });
  }
  currentData = parsed as Record<string, unknown>;

  const currentSlides = Array.isArray(currentData.slides)
    ? currentData.slides
    : [];
  const restoredDataJson = JSON.stringify(restoredData);
  const timestampRevision = Date.parse(restoredUpdatedAt);
  if (!Number.isSafeInteger(timestampRevision)) {
    fail("Slide source revision cannot be advanced safely.", {
      statusCode: 409,
      errorCode: "slide_source_revision_exhausted",
    });
  }

  for (const candidate of restoredData.slides) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const slide = candidate as Record<string, unknown>;
    if (typeof slide.id !== "string" || typeof slide.sourceTsx !== "string") {
      continue;
    }

    let restoredSource: ReturnType<typeof readStoredSlideSource>;
    try {
      restoredSource = readStoredSlideSource(restoredDataJson, slide.id);
    } catch (error) {
      rethrowSlideSourceFailure(error);
    }

    const currentHasSource = currentSlides.some(
      (currentSlide) =>
        currentSlide &&
        typeof currentSlide === "object" &&
        !Array.isArray(currentSlide) &&
        (currentSlide as Record<string, unknown>).id === slide.id &&
        typeof (currentSlide as Record<string, unknown>).sourceTsx === "string",
    );
    let currentSource: ReturnType<typeof readStoredSlideSource> | null = null;
    if (currentHasSource) {
      try {
        currentSource = readStoredSlideSource(currentDataJson, slide.id);
      } catch (error) {
        rethrowSlideSourceFailure(error);
      }
    }

    if (currentSource?.slide.sourceTsx === restoredSource.slide.sourceTsx) {
      slide.revision = currentSource.revision;
      slide.sourceHash = currentSource.sourceHash;
      continue;
    }

    const nextRevision = Math.max(
      timestampRevision + 1,
      (currentSource?.revision ?? 0) + 1,
      restoredSource.revision + 1,
    );
    if (!Number.isSafeInteger(nextRevision)) {
      fail("Slide source revision cannot be advanced safely.", {
        statusCode: 409,
        errorCode: "slide_source_revision_exhausted",
      });
    }
    slide.revision = nextRevision;
    slide.sourceHash = restoredSource.sourceHash;
  }
}

export default defineAction({
  description:
    "Restore a deck to a saved history snapshot. The current deck is snapshotted first, so restore is reversible.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    versionId: z.string().describe("Version snapshot ID to restore"),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    idempotentHint: false,
  },
  retrySafe: false,
  run: async ({ deckId, versionId }, ctx) => {
    let access;
    try {
      access = await assertAccess("deck", deckId, "editor");
    } catch (error) {
      if (error instanceof ForbiddenError) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      throw error;
    }
    const current = access.resource;
    const ownerEmail = current.ownerEmail as string;
    assertSlides2DeckData(current.data);
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
    const data = JSON.parse(version.data) as Record<string, unknown>;
    const now = nextDeckRevision(current.updatedAt);
    const title = version.title || data?.title || current.title || "Untitled";
    data.title = title;

    const designSystemId =
      typeof data.designSystemId === "string" && data.designSystemId
        ? data.designSystemId
        : null;
    reconcileRestoredSourceRevisions(current.data, data, now);
    if (
      current.title === title &&
      current.designSystemId === designSystemId &&
      deckVersionContentSignature(current.data) ===
        deckVersionContentSignature(data)
    ) {
      if (isAgentPatchCaller(ctx?.caller)) {
        fail(
          "Nothing was written: the selected deck version already matches the current deck. Re-read with get-deck before retrying.",
          {
            errorCode: "deck_version_already_current",
            statusCode: 409,
          },
        );
      }
      return {
        id: deckId,
        title,
        slideCount: Array.isArray(data?.slides) ? data.slides.length : 0,
        restoredVersionId: versionId,
        updatedAt: current.updatedAt,
        url: getDeckUrl(deckId),
        applied: false,
      };
    }

    assertDeckInlineImagesPersistable(null, data);
    data.updatedAt = now;

    const persisted = await db.transaction(async (tx: any) => {
      await lockSlideAssetReferences(
        tx,
        data,
        {
          ownerEmail,
          orgId: current.orgId,
        },
        current.id,
      );
      await createDeckVersionSnapshot(
        {
          id: current.id,
          title: current.title,
          data: current.data,
          ownerEmail,
        },
        {
          force: true,
          chatContext: deckVersionChatContextFromAction(ctx),
          label: "Before restore",
          db: tx,
        },
      );
      const updateResult = await tx
        .update(schema.decks)
        .set({
          title,
          data: JSON.stringify(data),
          designSystemId,
          updatedAt: now,
        })
        .where(deckRevisionWhere(schema.decks, deckId, current.updatedAt));
      assertDeckWriteApplied(updateResult, deckId, "deck restore");

      const [restored] = await tx
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          data: schema.decks.data,
          designSystemId: schema.decks.designSystemId,
          updatedAt: schema.decks.updatedAt,
        })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (
        !restored ||
        restored.id !== deckId ||
        restored.title !== title ||
        restored.data !== JSON.stringify(data) ||
        (restored.designSystemId ?? null) !== designSystemId ||
        restored.updatedAt !== now
      ) {
        fail("The restored deck could not be confirmed after writing.", {
          errorCode: "deck_restore_readback_failed",
          statusCode: 503,
        });
      }
      return restored;
    });

    const agentChangeId = deckVersionChangeGroupFromAction(ctx);
    if (agentChangeId) {
      await notifyClients(deckId, { agentChangeId });
    } else {
      await notifyClients(deckId);
    }
    await writeAppState("refresh-signal", {
      ts: now,
      source: "restore-deck-version",
    });

    const persistedData = JSON.parse(persisted.data);
    return {
      id: persisted.id,
      title: persisted.title,
      slideCount: Array.isArray(persistedData?.slides)
        ? persistedData.slides.length
        : 0,
      restoredVersionId: versionId,
      updatedAt: persisted.updatedAt,
      url: getDeckUrl(deckId),
      appUrl: getDeckUrl(deckId),
    };
  },
});
