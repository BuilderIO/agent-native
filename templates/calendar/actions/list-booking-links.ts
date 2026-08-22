import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { rowToBookingLink } from "../server/lib/booking-link-utils.js";

type EffectiveRole = "owner" | ShareRole;

function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function strongerRole(current: ShareRole | null, next: ShareRole): ShareRole {
  if (!current || ROLE_RANK[next] > ROLE_RANK[current]) return next;
  return current;
}

export default defineAction({
  description: "List all booking links",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const userEmail = normalizeEmail(getRequestUserEmail());
    const orgId = getRequestOrgId();
    const rows = await db
      .select()
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares))
      .orderBy(desc(schema.bookingLinks.updatedAt));

    if (rows.length === 0) return [];

    const principalClauses: NonNullable<ReturnType<typeof and>>[] = [];
    if (userEmail) {
      principalClauses.push(
        and(
          eq(schema.bookingLinkShares.principalType, "user"),
          sql`lower(${schema.bookingLinkShares.principalId}) = ${userEmail}`,
        )!,
      );
    }
    if (orgId) {
      principalClauses.push(
        and(
          eq(schema.bookingLinkShares.principalType, "org"),
          eq(schema.bookingLinkShares.principalId, orgId),
        )!,
      );
    }

    const shareRoleById = new Map<string, ShareRole>();
    if (principalClauses.length > 0) {
      const shareRows = await db
        .select({
          resourceId: schema.bookingLinkShares.resourceId,
          role: schema.bookingLinkShares.role,
        })
        .from(schema.bookingLinkShares)
        .where(
          and(
            inArray(
              schema.bookingLinkShares.resourceId,
              rows.map((row) => row.id),
            ),
            or(...principalClauses),
          ),
        );
      for (const share of shareRows) {
        shareRoleById.set(
          share.resourceId,
          strongerRole(shareRoleById.get(share.resourceId) ?? null, share.role),
        );
      }
    }

    return rows.map((row) => {
      let role: EffectiveRole = shareRoleById.get(row.id) ?? "viewer";
      if (
        userEmail &&
        normalizeEmail(row.ownerEmail) === userEmail &&
        (!row.orgId || row.orgId === orgId)
      ) {
        role = "owner";
      }
      return { ...rowToBookingLink(row), accessRole: role };
    });
  },
});
