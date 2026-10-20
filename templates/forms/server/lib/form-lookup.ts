import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

type FormsDb = ReturnType<typeof getDb>;

export async function findFormBySlugOrId(db: FormsDb, slugOrId: string) {
  const identifier = slugOrId.trim();
  if (!identifier || identifier.length > 200) return undefined;

  // guard:allow-unscoped — public handlers resolve a supplied public id; submissions need archived form settings for idempotent delivery retries, while new public reads and submissions reject non-published/deleted rows.
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
