import { defineAction } from "@agent-native/core/action";
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
import { resolveDefaultDesignSystemId } from "../server/workspace-defaults.js";

type EffectiveRole = "owner" | ShareRole;

function canManageRole(role: EffectiveRole) {
  return role === "owner" || role === "admin";
}

function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function strongerRole(current: ShareRole | null, next: ShareRole): ShareRole {
  if (!current || ROLE_RANK[next] > ROLE_RANK[current]) return next;
  return current;
}

function cachedBuilderDocCount(data: string | null): number | undefined {
  if (!data) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // coercion-ok: unparseable row data leaves the count unknown, and
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const docCount = (parsed as Record<string, unknown>).docCount;
  return typeof docCount === "number" ? docCount : undefined;
}

export default defineAction({
  description:
    "List all design systems accessible to the current user. Returns title, " +
    "id, and isDefault (true only for the caller's effective default). For a " +
    "named system, match the exact title and pass its id as designSystemId " +
    "— or pass the title as `designSystem` on create-deck — then call " +
    "get-design-system once before authoring.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output (id, title, isDefault only)"),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpApp: { compactCatalog: true },
  run: async (args) => {
    const db = getDb();
    const userEmail = normalizeEmail(getRequestUserEmail());
    const orgId = getRequestOrgId();
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

    const effectiveDefaultId = userEmail
      ? await resolveDefaultDesignSystemId(userEmail)
      : null;

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

      const docCount = cachedBuilderDocCount(row.data);
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          isDefault: row.id === effectiveDefaultId,
          accessRole: role,
          canManage,
          docCount,
        };
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        data: row.data,
        docCount,
        isDefault: row.id === effectiveDefaultId,
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
