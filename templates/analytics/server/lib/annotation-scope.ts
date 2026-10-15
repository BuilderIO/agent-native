import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and, eq, isNull, sql, type Column } from "drizzle-orm";

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
