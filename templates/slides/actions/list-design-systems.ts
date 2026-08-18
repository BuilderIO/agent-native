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

type EffectiveRole = "owner" | ShareRole;

function canManageRole(role: EffectiveRole) {
  return role === "owner" || role === "admin";
}

// Mirrors the core access model (assertAccess/resolveAccess), which compares
// emails with `lower(column) = lowercased-input` so a share or ownership
// grant survives casing differences between the stored principal and the
// caller's session email.
function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function strongerRole(current: ShareRole | null, next: ShareRole): ShareRole {
  if (!current || ROLE_RANK[next] > ROLE_RANK[current]) return next;
  return current;
}

export default defineAction({
  description:
    "List all design systems accessible to the current user. " +
    "Returns title, id, and whether each is the default.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output (id, title, isDefault only)"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const userEmail = normalizeEmail(getRequestUserEmail());
    const orgId = getRequestOrgId();
    // Project only the columns this list returns. The default path returns
    // `data`, but neither path returns the heavy `assets` blob — a bare
    // `.select()` would load it off every row for nothing.
    const rows = await db
      .select({
        id: schema.designSystems.id,
        title: schema.designSystems.title,
        description: schema.designSystems.description,
        data: schema.designSystems.data,
        isDefault: schema.designSystems.isDefault,
        visibility: schema.designSystems.visibility,
        ownerEmail: schema.designSystems.ownerEmail,
        orgId: schema.designSystems.orgId,
        createdAt: schema.designSystems.createdAt,
        updatedAt: schema.designSystems.updatedAt,
      })
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares))
      .orderBy(desc(schema.designSystems.updatedAt));

    if (rows.length === 0) {
      return { count: 0, designSystems: [] };
    }

    // Resolve every row's role from a single batched shares query instead of
    // calling resolveAccess() per row, which would re-load each resource and
    // its shares (N+1) and fan out an unbounded Promise.all as the list grows.
    const principalClauses: NonNullable<ReturnType<typeof and>>[] = [];
    if (userEmail) {
      principalClauses.push(
        and(
          eq(schema.designSystemShares.principalType, "user"),
          sql`lower(${schema.designSystemShares.principalId}) = ${userEmail}`,
        )!,
      );
    }
    if (orgId) {
      principalClauses.push(
        and(
          eq(schema.designSystemShares.principalType, "org"),
          eq(schema.designSystemShares.principalId, orgId),
        )!,
      );
    }

    const shareRoleById = new Map<string, ShareRole>();
    if (principalClauses.length > 0) {
      const shareRows = await db
        .select({
          resourceId: schema.designSystemShares.resourceId,
          role: schema.designSystemShares.role,
        })
        .from(schema.designSystemShares)
        .where(
          and(
            inArray(
              schema.designSystemShares.resourceId,
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

    const items = rows.map((row) => {
      let role: EffectiveRole = shareRoleById.get(row.id) ?? "viewer";
      if (
        userEmail &&
        normalizeEmail(row.ownerEmail) === userEmail &&
        (!row.orgId || row.orgId === orgId)
      ) {
        role = "owner";
      }
      const canManage = canManageRole(role);

      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          isDefault: row.isDefault,
          accessRole: role,
          canManage,
        };
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        data: row.data,
        isDefault: row.isDefault,
        visibility: row.visibility,
        accessRole: role,
        canManage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, designSystems: items };
  },
});
