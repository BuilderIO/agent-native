import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export type PublicPlanMeta = {
  title: string;
  brief: string;
  kind: string;
};

export async function fetchPublicPlanMeta(
  id: string,
): Promise<PublicPlanMeta | null> {
  try {
    const [row] = await getDb()
      .select({
        title: schema.plans.title,
        brief: schema.plans.brief,
        visibility: schema.plans.visibility,
        kind: schema.plans.kind,
        deletedAt: schema.plans.deletedAt,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, id))
      .limit(1);

    if (!row || row.visibility !== "public" || row.deletedAt) return null;

    return {
      title: row.title,
      brief: row.brief,
      kind: row.kind ?? "plan",
    };
  } catch {
    return null;
  }
}
