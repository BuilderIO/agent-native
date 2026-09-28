import { defineAction } from "@agent-native/core/action";
import {
  fetchBuilderDesignSystemDocumentCount,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
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
import { canManageDesignSystemRole } from "../server/lib/design-system-access.js";
import { resolveDefaultDesignSystemId } from "../server/lib/design-system-defaults.js";

type EffectiveRole = "owner" | ShareRole;

function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function strongerRole(current: ShareRole | null, next: ShareRole): ShareRole {
  if (!current || ROLE_RANK[next] > ROLE_RANK[current]) return next;
  return current;
}

function withLiveDocCount(data: string, docCount: number): string {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  return JSON.stringify({
    ...parsed,
    docCount,
    builderStatus: docCount > 0 ? "ready" : "in-progress",
  });
}

export default defineAction({
  description:
    "List all design systems accessible to the current user. Returns title, " +
    "id, and isDefault (true only for the caller's effective default). For a " +
    "named system, match the exact title and pass its id as designSystemId " +
    "— or pass the title as `designSystem` on create-design — then call " +
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
        assets: schema.designSystems.assets,
        customInstructions: schema.designSystems.customInstructions,
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

    const builderRows = rows
      .map((row) => ({
        row,
        reference: parseBuilderDesignSystemProxyReference(row.data),
      }))
      .filter(
        (
          entry,
        ): entry is {
          row: (typeof rows)[number];
          reference: NonNullable<typeof entry.reference>;
        } => entry.reference !== null,
      );
    const liveDocCounts = new Map<string, number>();
    const liveRowData = new Map<string, string>();
    if (builderRows.length > 0) {
      const results = await Promise.all(
        builderRows.map(async ({ row, reference }) => {
          const result = await fetchBuilderDesignSystemDocumentCount(
            reference.builderDesignSystemId,
          );
          return { row, result };
        }),
      );
      for (const { row, result } of results) {
        if (!result.ok) continue;
        liveDocCounts.set(row.id, result.docCount);
        liveRowData.set(row.id, withLiveDocCount(row.data, result.docCount));
      }
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
      const canManage = canManageDesignSystemRole(role);
      const data = liveRowData.get(row.id) ?? row.data;
      const docCount = liveDocCounts.get(row.id);
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
        data,
        docCount,
        assets: row.assets,
        customInstructions: row.customInstructions ?? "",
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
