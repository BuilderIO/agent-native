import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export const SHARE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Mirrors /p/<id>: a snapshot is only served while its deck still exists and is public.
export async function findLiveDeckShareLink(token: string) {
  const [row] = await getDb()
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
  if (!row) return null;
  const age = Date.now() - new Date(row.shared.createdAt).getTime();
  return age > SHARE_LINK_TTL_MS ? null : row.shared;
}
