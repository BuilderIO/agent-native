import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

type FormsDb = ReturnType<typeof getDb>;

/** Resolve public form identifiers without requiring callers to know storage ids. */
export async function findFormBySlugOrId(db: FormsDb, slugOrId: string) {
  const identifier = slugOrId.trim();
  if (!identifier || identifier.length > 200) return undefined;

  const [bySlug] = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.slug, identifier));
  if (bySlug) return bySlug;

  const [byId] = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, identifier));
  return byId;
}
