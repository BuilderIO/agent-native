import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export const SHARE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Mirrors /p/<id>: a snapshot is only served while its deck still exists and is public.
export async function findLiveDeckShareLink(token: string) {
  const rows = await getDb()
    .select({ shared: schema.deckShareLinks })
    .from(schema.deckShareLinks)
    .innerJoin(schema.decks, eq(schema.decks.id, schema.deckShareLinks.deckId))
    .where(
      and(
        eq(schema.deckShareLinks.token, token),
        eq(schema.decks.visibility, "public"),
      ),
    )
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  const age = Date.now() - new Date(row.shared.createdAt).getTime();
  return age > SHARE_LINK_TTL_MS ? null : row.shared;
}

export async function hasLiveDeckShareLinkReferencing(
  url: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ createdAt: schema.deckShareLinks.createdAt })
    .from(schema.deckShareLinks)
    .innerJoin(schema.decks, eq(schema.decks.id, schema.deckShareLinks.deckId))
    .where(
      and(
        eq(schema.decks.visibility, "public"),
        sql`strpos(${schema.deckShareLinks.slides}, ${url}) > 0`,
      ),
    );
  return rows.some(
    (row) =>
      Date.now() - new Date(row.createdAt).getTime() <= SHARE_LINK_TTL_MS,
  );
}
