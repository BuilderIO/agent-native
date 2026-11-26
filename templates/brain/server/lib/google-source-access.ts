import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export async function invalidateGoogleSourceAudiences(sourceId: string) {
  const db = getDb();
  const captureAudiences = db
    .select({ audienceId: schema.brainCaptureAudiences.audienceId })
    .from(schema.brainCaptureAudiences)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainRawCaptures.id, schema.brainCaptureAudiences.captureId),
    )
    .where(eq(schema.brainRawCaptures.sourceId, sourceId));
  await db
    .update(schema.brainAudiences)
    .set({
      membershipState: "stale",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.brainAudiences.sourceId, sourceId),
        inArray(schema.brainAudiences.id, captureAudiences),
      ),
    );
}

export async function invalidateGoogleCaptureAudiences(
  sourceId: string,
  externalIds: string[],
) {
  if (!externalIds.length) return;
  const db = getDb();
  const audiences = db
    .select({ audienceId: schema.brainCaptureAudiences.audienceId })
    .from(schema.brainCaptureAudiences)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainRawCaptures.id, schema.brainCaptureAudiences.captureId),
    )
    .where(
      and(
        eq(schema.brainRawCaptures.sourceId, sourceId),
        inArray(schema.brainRawCaptures.externalId, externalIds),
      ),
    );
  await db
    .update(schema.brainAudiences)
    .set({ membershipState: "stale", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.brainAudiences.sourceId, sourceId),
        inArray(schema.brainAudiences.id, audiences),
      ),
    );
}
