import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { schema, type getDb } from "../db/index.js";

export const DECK_ACCESS_REQUESTED_EVENT = "deck.access_requested";

export type AccessRequestPayload = {
  requestId?: string;
  requesterEmail?: string;
  requesterName?: string;
  requestedAt?: string;
  note?: string;
  approvalTokenHash?: string;
  accessGrantedAt?: string;
  accessShareId?: string;
  notifiedOwner?: boolean;
  notifiedAt?: string;
  inAppNotified?: boolean;
  emailNotified?: boolean;
  notificationClaimedAt?: string;
  notificationClaimToken?: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deterministic event id: one access request row per deck and requester. */
export function accessRequestEventId(
  deckId: string,
  requesterEmail: string,
): string {
  return (
    "access-request-" +
    createHash("sha256")
      .update(deckId)
      .update("\0")
      .update(normalizeEmail(requesterEmail))
      .digest("hex")
  );
}

export function parseAccessRequestPayload(
  payload: string | null | undefined,
): AccessRequestPayload | null {
  try {
    const parsed = JSON.parse(payload ?? "") as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as AccessRequestPayload)
      : null;
  } catch {
    // coercion-ok: malformed historical event payload cannot represent a matching requester.
    return null;
  }
}

/**
 * An approved request stays approved in its row. When the requester has no
 * access now, the share was removed later and the request is closed: the
 * requester may ask again.
 */
export function isGrantedAccessRequest(
  payload: AccessRequestPayload | null,
): boolean {
  return Boolean(payload?.accessGrantedAt);
}

/** The recorded access request `requesterEmail` made for a deck. */
export async function findDeckAccessRequest(
  db: ReturnType<typeof getDb>,
  deckId: string,
  requesterEmail: string,
): Promise<
  | { id: string; payload: string | null; parsed: AccessRequestPayload }
  | undefined
> {
  const email = normalizeEmail(requesterEmail);
  const rows = await db
    .select({
      id: schema.deckEvents.id,
      payload: schema.deckEvents.payload,
    })
    .from(schema.deckEvents)
    .where(eq(schema.deckEvents.id, accessRequestEventId(deckId, email)));
  for (const row of rows) {
    const parsed = parseAccessRequestPayload(row.payload);
    if (
      typeof parsed?.requesterEmail === "string" &&
      normalizeEmail(parsed.requesterEmail) === email
    ) {
      return { ...row, parsed };
    }
  }
  return undefined;
}
