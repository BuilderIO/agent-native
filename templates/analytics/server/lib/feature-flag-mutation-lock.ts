import { and, eq, lte } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { AnalyticsAdminContext } from "./db-admin-connections.js";

export async function withFeatureFlagMutationLock<T>(
  admin: AnalyticsAdminContext,
  target: { appId: string; flagKey: string; operationId: string },
  operation: () => Promise<T>,
): Promise<T> {
  const lockKey = `${admin.orgId}:${target.appId}:${target.flagKey}`;
  const lockToken = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  await getDb()
    .delete(schema.featureFlagMutationLocks)
    .where(
      and(
        eq(schema.featureFlagMutationLocks.lockKey, lockKey),
        lte(schema.featureFlagMutationLocks.createdAt, staleBefore),
      ),
    );
  try {
    await getDb().insert(schema.featureFlagMutationLocks).values({
      lockKey,
      lockToken,
      operationId: target.operationId,
      orgId: admin.orgId,
      createdAt: new Date().toISOString(),
    });
  } catch {
    throw new Error(
      "Another feature flag operation is already changing this app and flag.",
    );
  }

  try {
    return await operation();
  } finally {
    try {
      await getDb()
        .delete(schema.featureFlagMutationLocks)
        .where(
          and(
            eq(schema.featureFlagMutationLocks.lockKey, lockKey),
            eq(schema.featureFlagMutationLocks.lockToken, lockToken),
          ),
        );
    } catch {
      // Preserve the authoritative operation result. A stranded lock is
      // bounded and removed by the stale-lock cleanup above after five minutes.
    }
  }
}
