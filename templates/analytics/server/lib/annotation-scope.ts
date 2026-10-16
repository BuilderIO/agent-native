import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and, eq, isNull, sql, type Column, type SQL } from "drizzle-orm";

import { getDb } from "../db/index.js";

/** Who key dates and data notes are read and written for. */
export type AnnotationScope = { email: string; orgId: string | null };

export function requireAnnotationScope(): AnnotationScope {
  const email = getRequestUserEmail()?.trim();
  if (!email) {
    fail("Sign in to manage key dates and data notes.", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  }
  const orgId = getRequestOrgId()?.trim();
  return { email, orgId: orgId ? orgId : null };
}

/** An organization's annotations belong to all its members; without one they are the user's own. */
export function inAnnotationScope(
  table: { orgId: Column; ownerEmail: Column },
  scope: AnnotationScope,
) {
  return scope.orgId
    ? eq(table.orgId, scope.orgId)
    : and(
        isNull(table.orgId),
        sql`lower(${table.ownerEmail}) = ${scope.email.toLowerCase()}`,
      );
}

/**
 * Serializes a scope's annotation writes until `tx` ends, so a read, its
 * checks and the write that depends on them see no other writer in between.
 */
export async function lockAnnotationScope(
  tx: { execute(query: SQL): Promise<unknown> },
  scope: AnnotationScope,
): Promise<void> {
  const key = scope.orgId
    ? `org:${scope.orgId}`
    : `user:${scope.email.toLowerCase()}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('analytics-annotations:' || ${key}))`,
  );
}

/**
 * Refuses an edit made from a copy older than the saved one, so a form opened
 * before someone else's save can't quietly undo it. Call it under the lock.
 */
export function failIfChangedSince(
  what: "data note" | "key date" | "key-date set",
  expectedUpdatedAt: string | undefined,
  updatedAt: string,
): void {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === updatedAt) {
    return;
  }
  fail(
    `This ${what} changed after you opened it, so your edit wasn't saved. Open it again and redo the edit.`,
    { errorCode: "annotation_conflict", statusCode: 409 },
  );
}

/** Runs `write` in one transaction that holds the scope's lock from its start. */
export function writeInAnnotationScope<T>(
  scope: AnnotationScope,
  write: (tx: any) => Promise<T>,
): Promise<T> {
  return (getDb() as any).transaction(async (tx: any) => {
    await lockAnnotationScope(tx, scope);
    return write(tx);
  });
}
