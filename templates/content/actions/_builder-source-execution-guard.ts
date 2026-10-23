import { fail } from "@agent-native/core/action";
import { and, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { isBuilderExecutionClaimStale } from "./_builder-cms-execution-lease.js";

export async function assertNoActiveBuilderSourceExecutions(
  tx: ReturnType<typeof getDb>,
  sourceIds: string[],
  changeSetIds?: string[],
) {
  if (sourceIds.length === 0 || changeSetIds?.length === 0) return;

  const candidates = await tx
    .select({
      state: schema.contentDatabaseSourceExecutions.state,
      updatedAt: schema.contentDatabaseSourceExecutions.updatedAt,
    })
    .from(schema.contentDatabaseSourceExecutions)
    .where(
      and(
        inArray(schema.contentDatabaseSourceExecutions.sourceId, sourceIds),
        changeSetIds
          ? inArray(
              schema.contentDatabaseSourceExecutions.changeSetId,
              changeSetIds,
            )
          : undefined,
        inArray(schema.contentDatabaseSourceExecutions.state, [
          "running",
          "response_received",
          "reconciliation_required",
        ]),
      ),
    );
  const now = new Date().toISOString();
  const active = candidates.some(
    (execution) =>
      execution.state !== "running" ||
      !isBuilderExecutionClaimStale(execution.updatedAt, now),
  );
  if (active) {
    fail(
      "Cannot replace source records while a Builder execution is running or awaiting reconciliation.",
      { errorCode: "builder_execution_running", statusCode: 409 },
    );
  }
}
