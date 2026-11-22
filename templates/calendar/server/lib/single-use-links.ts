import {
  getAppProductionUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

export const SINGLE_USE_LINK_QUERY_PARAM = "once";

export type SingleUseLinkStatus = "available" | "used" | "revoked";

export type SingleUseLink = {
  token: string;
  bookingLinkId: string;
  status: SingleUseLinkStatus;
  createdBy: string;
  createdAt: string;
  usedAt: string | null;
  bookingId: string | null;
  revokedAt: string | null;
};

export const singleUseLinkOutputSchema = z.object({
  token: z.string(),
  bookingLinkId: z.string(),
  status: z.enum(["available", "used", "revoked"]),
  url: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  usedAt: z.string().nullable(),
  bookingId: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

type TokenRow = typeof schema.bookingLinkSingleUseTokens.$inferSelect;
type UpdateDb = Pick<ReturnType<typeof getDb>, "update">;

function statusOf(row: TokenRow): SingleUseLinkStatus {
  if (row.usedAt) return "used";
  if (row.revokedAt) return "revoked";
  return "available";
}

function toSingleUseLink(row: TokenRow): SingleUseLink {
  return {
    token: row.token,
    bookingLinkId: row.bookingLinkId,
    status: statusOf(row),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    usedAt: row.usedAt ?? null,
    bookingId: row.bookingId ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export function readSingleUseToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{10,64}$/.test(token) ? token : undefined;
}

export async function createSingleUseLink(input: {
  bookingLinkId: string;
  createdBy: string;
}): Promise<SingleUseLink> {
  const row: TokenRow = {
    token: nanoid(),
    bookingLinkId: input.bookingLinkId,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    usedAt: null,
    bookingId: null,
    revokedAt: null,
  };
  await getDb().insert(schema.bookingLinkSingleUseTokens).values(row);
  return toSingleUseLink(row);
}

export async function listSingleUseLinks(
  bookingLinkId: string,
): Promise<SingleUseLink[]> {
  const rows = await getDb()
    .select()
    .from(schema.bookingLinkSingleUseTokens)
    .where(eq(schema.bookingLinkSingleUseTokens.bookingLinkId, bookingLinkId))
    .orderBy(desc(schema.bookingLinkSingleUseTokens.createdAt));
  return rows.map(toSingleUseLink);
}

export async function getSingleUseLinkStatus(
  bookingLinkId: string,
  token: string,
): Promise<SingleUseLinkStatus | "missing"> {
  const rows = await getDb()
    .select()
    .from(schema.bookingLinkSingleUseTokens)
    .where(
      and(
        eq(schema.bookingLinkSingleUseTokens.token, token),
        eq(schema.bookingLinkSingleUseTokens.bookingLinkId, bookingLinkId),
      ),
    );
  const row = rows.find((candidate) => candidate.token === token);
  return row ? statusOf(row) : "missing";
}

export async function consumeSingleUseLink(
  tx: UpdateDb,
  input: {
    bookingLinkId: string;
    token: string;
    bookingId: string;
    usedAt: string;
  },
): Promise<boolean> {
  const rows = await tx
    .update(schema.bookingLinkSingleUseTokens)
    .set({ usedAt: input.usedAt, bookingId: input.bookingId })
    .where(
      and(
        eq(schema.bookingLinkSingleUseTokens.token, input.token),
        eq(
          schema.bookingLinkSingleUseTokens.bookingLinkId,
          input.bookingLinkId,
        ),
        isNull(schema.bookingLinkSingleUseTokens.usedAt),
        isNull(schema.bookingLinkSingleUseTokens.revokedAt),
      ),
    )
    .returning({ token: schema.bookingLinkSingleUseTokens.token });
  return rows.length > 0;
}

export async function releaseSingleUseLink(
  db: UpdateDb,
  bookingId: string,
): Promise<void> {
  await db
    .update(schema.bookingLinkSingleUseTokens)
    .set({ usedAt: null, bookingId: null })
    .where(eq(schema.bookingLinkSingleUseTokens.bookingId, bookingId));
}

export async function revokeSingleUseLink(
  bookingLinkId: string,
  token: string,
): Promise<SingleUseLink | null> {
  const where = and(
    eq(schema.bookingLinkSingleUseTokens.token, token),
    eq(schema.bookingLinkSingleUseTokens.bookingLinkId, bookingLinkId),
  );
  const revoked = await getDb()
    .update(schema.bookingLinkSingleUseTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        where,
        isNull(schema.bookingLinkSingleUseTokens.usedAt),
        isNull(schema.bookingLinkSingleUseTokens.revokedAt),
      ),
    )
    .returning();
  const rows =
    revoked.length > 0
      ? revoked
      : await getDb()
          .select()
          .from(schema.bookingLinkSingleUseTokens)
          .where(where);
  const row = rows.find((candidate) => candidate.token === token);
  return row ? toSingleUseLink(row) : null;
}

export async function deleteSingleUseLinksFor(
  bookingLinkId: string,
): Promise<void> {
  await getDb()
    .delete(schema.bookingLinkSingleUseTokens)
    .where(eq(schema.bookingLinkSingleUseTokens.bookingLinkId, bookingLinkId));
}

export function buildSingleUseLinkUrl(input: {
  username: string;
  slug: string;
  token: string;
}): string {
  const base = withConfiguredAppBasePath(getAppProductionUrl());
  const path = input.username
    ? `/book/${encodeURIComponent(input.username)}/${encodeURIComponent(input.slug)}`
    : `/book/${encodeURIComponent(input.slug)}`;
  return `${base}${path}?${SINGLE_USE_LINK_QUERY_PARAM}=${encodeURIComponent(input.token)}`;
}
