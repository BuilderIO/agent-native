import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import { z } from "zod";

import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";

export type DeckPayload = Record<string, unknown>;

export const deckClientWriteSchema = z.object({
  clientId: z.string().min(1),
  sequence: z.number().int().positive(),
  expectedUpdatedAt: z.string().nullable().optional(),
});

export type DeckClientWrite = z.infer<typeof deckClientWriteSchema>;

type DeckWriteRevision = {
  updatedAt: string | null;
  lastWriteClientId?: string | null;
  lastWriteClientSequence?: number | null;
  lastWriteRevision?: string | null;
};

export function assertDeckClientWriteCurrent(
  resource: DeckWriteRevision,
  deckId: string,
  write: DeckClientWrite | undefined,
  options: { allowRevisionMismatch?: boolean } = {},
): "apply" | "already-applied" {
  if (!write) return "apply";

  const sameCurrentWriter =
    resource.lastWriteClientId === write.clientId &&
    resource.lastWriteRevision === resource.updatedAt;
  const lastSequence = resource.lastWriteClientSequence ?? 0;
  if (sameCurrentWriter && write.sequence < lastSequence) {
    throw deckHttpError(
      409,
      `Deck ${deckId} has a newer edit; keepalive replay was ignored.`,
    );
  }
  if (sameCurrentWriter && write.sequence === lastSequence) {
    return "already-applied";
  }
  if (
    !options.allowRevisionMismatch &&
    write.expectedUpdatedAt !== undefined &&
    write.expectedUpdatedAt !== resource.updatedAt &&
    !(sameCurrentWriter && write.sequence > lastSequence)
  ) {
    throw Object.assign(
      deckHttpError(
        409,
        `Deck ${deckId} changed while saving; re-read it before retrying.`,
      ),
      { errorCode: "deck_revision_conflict" },
    );
  }
  return "apply";
}

export function deckClientWriteFields(
  write: DeckClientWrite | undefined,
  revision: string | null,
): Pick<
  DeckWriteRevision,
  "lastWriteClientId" | "lastWriteClientSequence" | "lastWriteRevision"
> {
  return write
    ? {
        lastWriteClientId: write.clientId,
        lastWriteClientSequence: write.sequence,
        lastWriteRevision: revision,
      }
    : {};
}

export function nextDeckRevision(
  expectedUpdatedAt: string | null | undefined,
  now = new Date(),
): string {
  const expectedMs = expectedUpdatedAt
    ? Date.parse(expectedUpdatedAt)
    : Number.NaN;
  const nextMs = Number.isFinite(expectedMs)
    ? Math.max(now.getTime(), expectedMs + 1)
    : now.getTime();
  return new Date(nextMs).toISOString();
}

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
    throw Object.assign(
      deckHttpError(
        409,
        `Deck ${deckId} changed while saving ${operation}; re-read the deck and retry the edit.`,
      ),
      { errorCode: "deck_write_conflict" },
    );
  }
}

export async function retryDeckWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        (error as { errorCode?: unknown })?.errorCode !==
          "deck_write_conflict" ||
        attempt === 5
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 25 * (attempt + 1)),
      );
    }
  }
}

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
