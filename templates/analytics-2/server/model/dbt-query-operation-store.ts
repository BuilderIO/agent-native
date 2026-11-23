import { fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { requireWorkspaceScope, type WorkspaceScope } from "./scope.js";

/** Atomic compare-and-set with no replay of the updater after contention. */
export async function mutateDbtQueryOperation(
  scopeInput: WorkspaceScope,
  id: string,
  update: (current: Record<string, unknown> | null) => Record<string, unknown>,
) {
  const scope = requireWorkspaceScope(scopeInput);
  await ensureAnalyticsDatabase();
  const table = schema.dbtQueryOperations;
  const match = and(
    eq(table.id, id),
    eq(table.ownerEmail, scope.ownerEmail),
    eq(table.orgId, scope.orgId),
  );
  const [old] = await getDb().select().from(table).where(match).limit(1);
  const next = update(old ? JSON.parse(old.value) : null);
  const value = JSON.stringify(next);
  const changed = old
    ? await getDb()
        .update(table)
        .set({ value })
        .where(and(match, eq(table.value, old.value)))
        .returning({ id: table.id })
    : await getDb()
        .insert(table)
        .values({ id, ...scope, value })
        .onConflictDoNothing()
        .returning({ id: table.id });
  if (changed.length !== 1)
    fail("This metric query changed. Reload before continuing.", {
      statusCode: 409,
      errorCode: "dbt_query_operation_changed",
    });
  return next;
}
