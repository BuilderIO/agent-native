/**
 * Shared helpers for the editor-owned deck write actions (`add-deck`,
 * `save-deck`, `delete-deck`). Underscore-prefixed so action discovery skips
 * it — this module is not itself an action.
 */
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq, isNull, type AnyColumn } from "drizzle-orm";

import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";

/** A deck is stored as one opaque JSON blob in `decks.data`. */
export type DeckPayload = Record<string, unknown>;

export function deckRevisionWhere(
  table: { id: AnyColumn; updatedAt: AnyColumn },
  deckId: string,
  expectedUpdatedAt: string | null | undefined,
): ReturnType<typeof and> {
  if (expectedUpdatedAt === undefined) {
    throw new Error(
      `Deck ${deckId} is missing its revision. Re-read it before saving.`,
    );
  }
  return and(
    eq(table.id, deckId),
    expectedUpdatedAt === null
      ? isNull(table.updatedAt)
      : eq(table.updatedAt, expectedUpdatedAt),
  );
}

export function assertDeckWriteApplied(
  result: unknown,
  deckId: string,
  operation: string,
): void {
  const candidate = result as {
    rowsAffected?: unknown;
    affectedRows?: unknown;
    rowCount?: unknown;
    count?: unknown;
    changes?: unknown;
    meta?: { changes?: unknown };
  } | null;
  const affected =
    candidate?.rowsAffected ??
    candidate?.affectedRows ??
    candidate?.rowCount ??
    candidate?.count ??
    candidate?.changes ??
    candidate?.meta?.changes;
  if (typeof affected !== "number") {
    throw new Error(
      `Database did not report the affected row count for ${operation} on deck ${deckId}; refusing to claim persistence.`,
    );
  }
  if (affected !== 1) {
    throw new Error(
      `Deck ${deckId} changed while saving ${operation}; re-read the deck and retry the edit.`,
    );
  }
}

/**
 * Actions surface HTTP status through `statusCode`; the action route echoes the
 * message verbatim for client errors and swallows it for anything >= 500.
 */
export function deckHttpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function deckTitle(deck: DeckPayload): string {
  return typeof deck.title === "string" && deck.title ? deck.title : "Untitled";
}

export function deckDesignSystemId(deck: DeckPayload): string | null {
  return typeof deck.designSystemId === "string" && deck.designSystemId
    ? deck.designSystemId
    : null;
}

export function assertValidAspectRatio(deck: DeckPayload): void {
  if (
    "aspectRatio" in deck &&
    !ASPECT_RATIO_VALUES.includes(deck.aspectRatio as never)
  ) {
    throw deckHttpError(400, "Invalid aspect ratio");
  }
}

export async function assertDesignSystemReadable(
  designSystemId: string | null,
): Promise<void> {
  if (!designSystemId) return;
  try {
    await assertAccess("design-system", designSystemId, "viewer");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      throw deckHttpError(400, "Design system not accessible");
    }
    throw err;
  }
}
