import type { H3Event } from "h3";
import { eq, or, sql, type SQL } from "drizzle-orm";
import { getSession } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { schema } from "../db/index.js";

export function parseDocumentFavorite(
  value: boolean | number | string | null | undefined,
): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "t";
  }
  return false;
}

export function parseDocumentHideFromSearch(
  value: boolean | number | string | null | undefined,
): boolean {
  return parseDocumentFavorite(value);
}

export function documentDiscoveryFilter(): SQL {
  const userEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  const clauses: SQL[] = [
    eq(schema.documents.hideFromSearch, 0),
    sql`${schema.documents.hideFromSearch} IS NULL`,
    sql`${schema.documents.visibility} <> 'org'`,
  ];

  if (userEmail) {
    clauses.push(eq(schema.documents.ownerEmail, userEmail));
    clauses.push(sql`exists (select 1 from ${schema.documentShares}
      where ${schema.documentShares.resourceId} = ${schema.documents.id}
        and ${schema.documentShares.principalType} = 'user'
        and ${schema.documentShares.principalId} = ${userEmail})`);
  }

  if (orgId) {
    clauses.push(sql`exists (select 1 from ${schema.documentShares}
      where ${schema.documentShares.resourceId} = ${schema.documents.id}
        and ${schema.documentShares.principalType} = 'org'
        and ${schema.documentShares.principalId} = ${orgId})`);
  }

  return or(...clauses) ?? sql`1=0`;
}

export function getCurrentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}
