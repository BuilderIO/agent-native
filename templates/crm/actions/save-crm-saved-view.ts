import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CrmFilterError,
  crmFilterSchema,
  crmSortSchema,
  hydrateSavedViewRow,
  normalizeStoredColumns,
  normalizeStoredFilter,
} from "../server/lib/crm-query.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";

/** A save that lost a race — surfaces as HTTP 409 instead of clobbering. */
class CrmSavedViewConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "crm-saved-view-conflict";

  constructor(id: string, expected: string, actual: string) {
    super(
      `CRM saved view "${id}" changed between read and write (expected ${expected}, found ${actual}). Re-read it and re-apply your edit.`,
    );
    this.name = "CrmSavedViewConflictError";
  }
}

const columnsSchema = z
  .array(
    z.union([
      z.string().trim().min(1).max(128),
      z.object({
        attributeId: z.string().trim().min(1).max(128),
        width: z.number().int().min(40).max(1_200).optional(),
        hidden: z.boolean().optional(),
      }),
    ]),
  )
  .max(60);

export default defineAction({
  description:
    "Create or update a bounded, access-scoped CRM saved view: its typed filter, ordered sort, columns, table/board presentation, and personal/shared audience. Pass expectedUpdatedAt to reject an overwrite when the view changed since it was read. A saved view stores filters and presentation settings, never provider rows.",
  schema: z.object({
    id: z.string().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    /** Record kind (account/person/opportunity) — not the table/board kind. */
    kind: z.enum(["account", "person", "opportunity"]).optional(),
    viewKind: z.enum(["table", "board"]).optional(),
    targetKind: z.enum(["object", "list"]).optional(),
    targetId: z.string().trim().min(1).max(128).optional(),
    groupByAttributeId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe("Board views only; must reference a status attribute."),
    filter: crmFilterSchema.optional(),
    /** Legacy `{query, fieldEquals}` blob; normalized into `filter`. */
    filters: z.record(z.string().max(120), z.unknown()).optional(),
    columns: columnsSchema.optional(),
    sort: crmSortSchema.optional(),
    dataProgramId: z.string().trim().min(1).max(128).optional(),
    pinned: z.boolean().optional(),
    audience: z.enum(["personal", "shared"]).optional(),
    expectedUpdatedAt: z.string().min(1).max(64).optional(),
  }),
  audit: {
    target: (_args, result) => {
      const view = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-saved-view",
        id: view.id,
        ownerEmail: view.ownerEmail,
        orgId: view.orgId,
        visibility: view.visibility,
      };
    },
    summary: (args) => `Saved CRM view ${args.name}`,
  },
  run: async (args, ctx?: ActionRunContext) => {
    if (args.filter && args.filters) {
      throw new CrmFilterError(
        "crm-filter-conflict",
        "Pass either filter or the legacy filters blob, not both.",
      );
    }
    const db = getDb();
    const now = new Date().toISOString();
    const scope = requireCrmScope(ctx);

    const filter =
      args.filter ??
      (args.filters === undefined
        ? undefined
        : normalizeStoredFilter(args.filters));
    const columns =
      args.columns === undefined
        ? undefined
        : normalizeStoredColumns(args.columns);

    const existing = args.id ? await readView(args.id) : undefined;
    if (args.id && !existing) throw new Error("CRM saved view was not found.");

    const viewKind = args.viewKind ?? existing?.viewKind ?? "table";
    // Switching a board back to a table drops its grouping instead of
    // inheriting it — otherwise the switch would fail the board-only check.
    const groupByAttributeId =
      args.groupByAttributeId !== undefined
        ? args.groupByAttributeId
        : viewKind === "board"
          ? (existing?.groupByAttributeId ?? null)
          : null;
    if (viewKind === "board") {
      if (!groupByAttributeId) {
        throw new CrmFilterError(
          "crm-saved-view-group-by",
          "A board view needs groupByAttributeId naming a status attribute.",
        );
      }
      await assertStatusAttribute(groupByAttributeId);
    } else if (groupByAttributeId) {
      throw new CrmFilterError(
        "crm-saved-view-group-by",
        "groupByAttributeId only applies to a board view.",
      );
    }

    const visibility =
      args.audience === undefined
        ? undefined
        : audienceVisibility(args.audience, scope.orgId);

    if (args.id && existing) {
      await assertAccess("crm-saved-view", args.id, "editor");
      if (
        args.expectedUpdatedAt !== undefined &&
        args.expectedUpdatedAt !== existing.updatedAt
      ) {
        throw new CrmSavedViewConflictError(
          args.id,
          args.expectedUpdatedAt,
          existing.updatedAt,
        );
      }
      await db
        .update(schema.crmSavedViews)
        .set({
          name: args.name,
          ...(args.description !== undefined
            ? { description: args.description }
            : {}),
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          ...(args.viewKind !== undefined ? { viewKind } : {}),
          ...(args.targetKind !== undefined
            ? { targetKind: args.targetKind }
            : {}),
          ...(args.targetId !== undefined ? { targetId: args.targetId } : {}),
          groupByAttributeId,
          ...(filter !== undefined
            ? { filtersJson: toJson(filter, 8_000) }
            : {}),
          ...(columns !== undefined
            ? { columnsJson: toJson(columns, 8_000) }
            : {}),
          ...(args.sort !== undefined
            ? { sortJson: toJson(args.sort, 2_000) }
            : {}),
          ...(args.dataProgramId !== undefined
            ? { dataProgramId: args.dataProgramId }
            : {}),
          ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
          ...(visibility !== undefined ? { visibility } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.crmSavedViews.id, args.id),
            ...(args.expectedUpdatedAt !== undefined
              ? [eq(schema.crmSavedViews.updatedAt, args.expectedUpdatedAt)]
              : []),
          ),
        );
      const saved = await readView(args.id);
      if (!saved) throw new Error("CRM saved view was not found.");
      if (args.expectedUpdatedAt !== undefined && saved.updatedAt !== now) {
        // The guarded UPDATE matched nothing: another writer landed between the
        // read above and the write. Report it rather than returning the row we
        // did not write as if the save succeeded.
        throw new CrmSavedViewConflictError(
          args.id,
          args.expectedUpdatedAt,
          saved.updatedAt,
        );
      }
      return saved;
    }

    const id = crypto.randomUUID();
    await db.insert(schema.crmSavedViews).values({
      id,
      name: args.name,
      description: args.description ?? "",
      kind: args.kind ?? null,
      viewKind,
      targetKind: args.targetKind ?? "object",
      targetId: args.targetId ?? null,
      groupByAttributeId,
      filtersJson: toJson(filter ?? { op: "and", conditions: [] }, 8_000),
      columnsJson: toJson(columns ?? [], 8_000),
      sortJson: toJson(args.sort ?? [], 2_000),
      dataProgramId: args.dataProgramId ?? null,
      pinned: args.pinned ?? false,
      ...scope,
      ...(visibility !== undefined ? { visibility } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const saved = await readView(id);
    if (!saved)
      throw new Error("CRM saved view could not be verified after saving.");
    return saved;
  },
});

function audienceVisibility(
  audience: "personal" | "shared",
  orgId: string | null,
): "private" | "org" {
  if (audience === "personal") return "private";
  if (!orgId) {
    throw new CrmFilterError(
      "crm-saved-view-audience",
      "A shared view needs an active organization; this session has none.",
    );
  }
  return "org";
}

async function assertStatusAttribute(attributeId: string): Promise<void> {
  const [row] = await getDb()
    .select({
      attributeType: schema.crmFieldPolicies.attributeType,
      archived: schema.crmFieldPolicies.archived,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.id, attributeId),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    )
    .limit(1);
  if (!row) {
    throw new CrmFilterError(
      "crm-saved-view-group-by",
      `Board grouping references unknown attribute "${attributeId}".`,
    );
  }
  if (row.archived) {
    throw new CrmFilterError(
      "crm-saved-view-group-by",
      `Board grouping references archived attribute "${attributeId}".`,
    );
  }
  if (row.attributeType !== "status") {
    throw new CrmFilterError(
      "crm-saved-view-group-by",
      `Board grouping needs a status attribute; "${attributeId}" is ${row.attributeType}.`,
    );
  }
}

async function readView(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.crmSavedViews)
    .where(
      and(
        eq(schema.crmSavedViews.id, id),
        accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return { ...row, view: hydrateSavedViewRow(row) };
}
