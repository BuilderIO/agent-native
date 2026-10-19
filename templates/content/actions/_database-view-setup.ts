import { iconValueSchema } from "@agent-native/core/icons";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { syncPrivateViewIconReferences } from "../server/lib/private-icon-references.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterOperator,
  ContentDatabaseItemLayout,
  ContentDatabaseView,
  ContentDatabaseViewConfig,
} from "../shared/api.js";
import {
  CONTENT_DATABASE_ITEM_LAYOUT_PRESET_IDS,
  CONTENT_DATABASE_ITEM_LEADING_KINDS,
  CONTENT_DATABASE_ITEM_TITLE_WEIGHTS,
  MAX_ITEM_LAYOUT_META_PROPERTIES,
  contentDatabaseItemLayoutPresets,
  contentDatabaseItemLayoutReferenceErrors,
  itemLayoutLeadingCandidates,
  normalizeContentDatabaseItemLayout,
  startingContentDatabaseItemLayout,
} from "../shared/database-item-layout.js";
import {
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  runDatabaseSetupMutation,
  setupError,
  setupGuardSchema,
} from "./_database-setup-mutation.js";
import { nanoid, parseDatabaseViewConfig } from "./_property-utils.js";

const sortSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    label: z.string().max(500),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const filterSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    label: z.string().max(500),
    operator: z.enum([
      "contains",
      "equals",
      "does_not_equal",
      "greater_than",
      "less_than",
      "before",
      "after",
      "between",
      "is_checked",
      "is_unchecked",
      "is_empty",
      "is_not_empty",
    ]),
    value: z.string(),
    filterGroupId: z.string().max(200).optional(),
    parentFilterGroupId: z.string().max(200).optional(),
  })
  .strict();

const tablePatchFields = {
  sorts: z.array(sortSchema).max(100).optional(),
  filters: z.array(filterSchema).max(100).optional(),
  filterMode: z.enum(["and", "or"]).optional(),
  columnWidths: z
    .record(
      z.string().trim().min(1).max(200),
      z.number().finite().positive().max(4_000),
    )
    .optional(),
  hiddenPropertyIds: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  propertyOrderIds: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  tableColumnOrderIds: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  wrapCells: z.boolean().optional(),
  columnWrapOverrides: z
    .record(z.string().trim().min(1).max(200), z.boolean())
    .optional(),
  frozenThroughColumnId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
  rowDensity: z.enum(["compact", "default", "comfortable"]).optional(),
  openPagesIn: z.enum(["preview", "full_page"]).optional(),
};

const itemLayoutPropertyIdSchema = z.string().trim().min(1).max(200);
const itemLayoutLinesSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
const itemLayoutMetaSchema = z
  .array(itemLayoutPropertyIdSchema)
  .max(MAX_ITEM_LAYOUT_META_PROPERTIES);

export const contentDatabaseItemLayoutSchema = z
  .object({
    leading: z
      .object({
        kind: z.enum(CONTENT_DATABASE_ITEM_LEADING_KINDS),
        propertyId: itemLayoutPropertyIdSchema.nullable(),
      })
      .strict(),
    titleWeight: z.enum(CONTENT_DATABASE_ITEM_TITLE_WEIGHTS),
    line2: z
      .object({
        propertyId: itemLayoutPropertyIdSchema.nullable(),
        lines: itemLayoutLinesSchema,
      })
      .strict(),
    line3: itemLayoutMetaSchema,
    trailing: itemLayoutMetaSchema,
  })
  .strict();

const itemLayoutPatchSchema = z
  .object({
    leading: z
      .object({
        kind: z.enum(CONTENT_DATABASE_ITEM_LEADING_KINDS),
        propertyId: itemLayoutPropertyIdSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    titleWeight: z.enum(CONTENT_DATABASE_ITEM_TITLE_WEIGHTS).optional(),
    line2: z
      .object({
        propertyId: itemLayoutPropertyIdSchema.nullable().optional(),
        lines: itemLayoutLinesSchema.optional(),
      })
      .strict()
      .optional(),
    line3: itemLayoutMetaSchema.optional(),
    trailing: itemLayoutMetaSchema.optional(),
  })
  .strict()
  .describe(
    "List views only. Slots to change in each row; omitted slots keep their saved value. leading.kind checkbox or status uses the first property of that type unless propertyId names one. line2 shows a text, URL, or Blocks property; line3 and trailing list property IDs in order. Trailing values move under the title on narrow screens. Pass null to restore the default rows.",
  );

const listPatchFields = {
  itemLayout: itemLayoutPatchSchema.nullable().optional(),
  itemLayoutPreset: z
    .enum(CONTENT_DATABASE_ITEM_LAYOUT_PRESET_IDS)
    .optional()
    .describe(
      "List views only. Starts the rows from a preset before itemLayout applies: checklist (checkbox, bold title, two lines of text), reminders (checkbox, one line of text, date, person and tag under it), tracker (status dot, tag, person and date on the right), digest (page icon, bold title, three lines of text, details under it), or default.",
    ),
};

const LIST_VIEW_PATCH_KEYS = new Set([
  "name",
  "icon",
  ...Object.keys(listPatchFields),
]);

const boundedTablePatchSchema = z
  .object(tablePatchFields)
  .strict()
  .superRefine((patch, context) => {
    for (const key of ["columnWidths", "columnWrapOverrides"] as const) {
      if (patch[key] && Object.keys(patch[key]).length > 100) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} supports at most 100 entries`,
        });
      }
    }
  });

const updateViewPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(500).optional(),
    icon: iconValueSchema.nullable().optional(),
    ...tablePatchFields,
    ...listPatchFields,
  })
  .strict()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "View patch cannot be empty",
  );

export const updateContentDatabaseViewAgentSchema = z.discriminatedUnion(
  "operation",
  [
    setupGuardSchema
      .extend({
        expectedConfigurationRevision: z.string().min(1),
        operation: z.literal("create"),
        view: z
          .object({
            name: z.string().trim().min(1).max(500),
            type: z.literal("table"),
            icon: iconValueSchema.nullable().optional(),
            config: boundedTablePatchSchema.optional(),
          })
          .strict(),
      })
      .strict(),
    setupGuardSchema
      .extend({
        expectedConfigurationRevision: z.string().min(1),
        operation: z.literal("update"),
        viewId: z.string().trim().min(1).max(200),
        patch: updateViewPatchSchema,
      })
      .strict(),
  ],
);

export type UpdateContentDatabaseViewAgentInput = z.infer<
  typeof updateContentDatabaseViewAgentSchema
>;

const operatorsByType: Partial<
  Record<DocumentPropertyType, readonly ContentDatabaseFilterOperator[]>
> = {
  checkbox: ["is_checked", "is_unchecked"],
  select: ["contains", "does_not_equal", "is_empty", "is_not_empty"],
  status: ["contains", "does_not_equal", "is_empty", "is_not_empty"],
  multi_select: ["contains", "does_not_equal", "is_empty", "is_not_empty"],
  person: ["contains", "does_not_equal", "is_empty", "is_not_empty"],
  number: [
    "equals",
    "does_not_equal",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
  ],
  date: [
    "equals",
    "does_not_equal",
    "before",
    "after",
    "between",
    "is_empty",
    "is_not_empty",
  ],
  created_time: [
    "equals",
    "does_not_equal",
    "before",
    "after",
    "between",
    "is_empty",
    "is_not_empty",
  ],
  last_edited_time: [
    "equals",
    "does_not_equal",
    "before",
    "after",
    "between",
    "is_empty",
    "is_not_empty",
  ],
};

const defaultOperators: readonly ContentDatabaseFilterOperator[] = [
  "contains",
  "equals",
  "does_not_equal",
  "is_empty",
  "is_not_empty",
];

function uniqueReferences(values: readonly string[], field: string) {
  if (new Set(values).size !== values.length) {
    setupError(
      "INVALID_VIEW_REFERENCE",
      `${field} contains a duplicate reference.`,
      400,
    );
  }
}

function validateTablePatch(
  patch:
    | z.infer<typeof updateViewPatchSchema>
    | z.infer<typeof boundedTablePatchSchema>,
  definitions: readonly (typeof schema.documentPropertyDefinitions.$inferSelect)[],
) {
  const typeById = new Map(
    definitions.map((definition) => [
      definition.id,
      definition.type as DocumentPropertyType,
    ]),
  );
  const propertyIds = new Set(typeById.keys());
  const columnIds = new Set(["name", ...propertyIds]);
  const assertReferences = (
    values: readonly string[] | undefined,
    allowed: ReadonlySet<string>,
    field: string,
  ) => {
    if (!values) return;
    uniqueReferences(values, field);
    const invalid = values.find((value) => !allowed.has(value));
    if (invalid) {
      setupError(
        "INVALID_VIEW_REFERENCE",
        `${field} references unavailable property \"${invalid}\".`,
        400,
      );
    }
  };
  assertReferences(patch.hiddenPropertyIds, propertyIds, "hiddenPropertyIds");
  assertReferences(patch.propertyOrderIds, propertyIds, "propertyOrderIds");
  assertReferences(patch.tableColumnOrderIds, columnIds, "tableColumnOrderIds");
  assertReferences(
    patch.sorts?.map((sort) => sort.key),
    columnIds,
    "sorts",
  );
  assertReferences(
    patch.filters?.map((filter) => filter.key),
    columnIds,
    "filters",
  );
  assertReferences(
    patch.columnWidths ? Object.keys(patch.columnWidths) : undefined,
    columnIds,
    "columnWidths",
  );
  assertReferences(
    patch.columnWrapOverrides
      ? Object.keys(patch.columnWrapOverrides)
      : undefined,
    columnIds,
    "columnWrapOverrides",
  );
  if (
    patch.frozenThroughColumnId &&
    !columnIds.has(patch.frozenThroughColumnId)
  ) {
    setupError(
      "INVALID_VIEW_REFERENCE",
      `frozenThroughColumnId references unavailable property \"${patch.frozenThroughColumnId}\".`,
      400,
    );
  }
  for (const filter of patch.filters ?? []) {
    const type = filter.key === "name" ? "text" : typeById.get(filter.key)!;
    const allowed = operatorsByType[type] ?? defaultOperators;
    if (!allowed.includes(filter.operator)) {
      setupError(
        "INVALID_VIEW_REFERENCE",
        `Filter operator \"${filter.operator}\" is not valid for property \"${filter.key}\".`,
        400,
      );
    }
  }
}

type PropertyDefinitionRow =
  typeof schema.documentPropertyDefinitions.$inferSelect;

function itemLayoutProperties(definitions: readonly PropertyDefinitionRow[]) {
  return definitions.map((definition) => ({
    definition: {
      id: definition.id,
      type: definition.type as DocumentPropertyType,
      options: parsePropertyOptions(definition.optionsJson),
    },
  }));
}

/** The default rows' properties: the view's visible properties in its order. */
function defaultListRowProperties(
  view: ContentDatabaseView,
  definitions: readonly PropertyDefinitionRow[],
) {
  const hidden = new Set(view.hiddenPropertyIds ?? []);
  const order = view.propertyOrderIds ?? [];
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  return itemLayoutProperties(
    definitions
      .filter(
        (definition) =>
          definition.visibility !== "always_hide" && !hidden.has(definition.id),
      )
      .sort((a, b) => rank(a.id) - rank(b.id) || a.position - b.position),
  );
}

/**
 * Applies an agent's item layout patch to a list view. Returns undefined
 * when the patch leaves the layout alone and null to restore default rows.
 */
function nextListItemLayout(
  patch: z.infer<typeof updateViewPatchSchema>,
  view: ContentDatabaseView,
  definitions: readonly PropertyDefinitionRow[],
): ContentDatabaseItemLayout | null | undefined {
  const { itemLayout, itemLayoutPreset } = patch;
  if (itemLayout === undefined && itemLayoutPreset === undefined) {
    return undefined;
  }
  if (itemLayout === null && itemLayoutPreset !== undefined) {
    setupError(
      "INVALID_VIEW_REFERENCE",
      "Pass itemLayoutPreset or itemLayout: null, not both.",
      400,
    );
  }
  if (itemLayout === null) return null;
  const properties = itemLayoutProperties(definitions);
  let base = view.itemLayout ?? null;
  if (itemLayoutPreset !== undefined) {
    const preset = contentDatabaseItemLayoutPresets(properties).find(
      (candidate) => candidate.id === itemLayoutPreset,
    )!;
    if (preset.missingPropertyType) {
      setupError(
        "INVALID_VIEW_REFERENCE",
        `The ${preset.id} preset needs a ${preset.missingPropertyType} property.`,
        400,
      );
    }
    base = preset.layout;
  }
  if (!itemLayout) return base;
  base ??= startingContentDatabaseItemLayout(
    defaultListRowProperties(view, definitions),
  );
  for (const slot of ["line3", "trailing"] as const) {
    const ids = itemLayout[slot];
    if (ids) uniqueReferences(ids, slot);
  }
  const leading = itemLayout.leading
    ? {
        kind: itemLayout.leading.kind,
        propertyId:
          itemLayout.leading.propertyId ??
          itemLayoutLeadingCandidates(properties, itemLayout.leading.kind)[0]
            ?.definition.id ??
          null,
      }
    : base.leading;
  const next = normalizeContentDatabaseItemLayout({
    leading,
    titleWeight: itemLayout.titleWeight ?? base.titleWeight,
    line2: {
      propertyId:
        itemLayout.line2?.propertyId !== undefined
          ? itemLayout.line2.propertyId
          : base.line2.propertyId,
      lines: itemLayout.line2?.lines ?? base.line2.lines,
    },
    line3: itemLayout.line3 ?? base.line3,
    trailing: itemLayout.trailing ?? base.trailing,
  })!;
  const [error] = contentDatabaseItemLayoutReferenceErrors(next, properties);
  if (error) setupError("INVALID_VIEW_REFERENCE", error, 400);
  return next;
}

function parseRawConfig(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setupError(
        "READBACK_UNAVAILABLE",
        "Saved database views are unreadable.",
        500,
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      setupError(
        "READBACK_UNAVAILABLE",
        "Saved database views are unreadable.",
        500,
      );
    }
    throw error;
  }
}

function defaultTableView(
  id: string,
  name: string,
  patch: z.infer<typeof boundedTablePatchSchema> = {},
  icon?: z.infer<typeof iconValueSchema> | null,
): ContentDatabaseView {
  return {
    id,
    name,
    type: "table",
    icon,
    sorts: patch.sorts ?? [],
    filters: patch.filters ?? [],
    filterMode: patch.filterMode ?? "and",
    columnWidths: patch.columnWidths ?? {},
    hiddenPropertyIds: patch.hiddenPropertyIds ?? [],
    propertyOrderIds: patch.propertyOrderIds ?? [],
    tableColumnOrderIds: patch.tableColumnOrderIds ?? [],
    wrapCells: patch.wrapCells ?? false,
    columnWrapOverrides: patch.columnWrapOverrides ?? {},
    frozenThroughColumnId: patch.frozenThroughColumnId,
    rowDensity: patch.rowDensity ?? "default",
    openPagesIn: patch.openPagesIn ?? "preview",
  };
}

async function readCanonicalView(
  tx: ReturnType<typeof getDb>,
  databaseId: string,
  viewId: string,
) {
  const [database] = await tx
    .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  if (!database) {
    setupError(
      "NOT_FOUND_OR_INACCESSIBLE",
      "The database is unavailable.",
      404,
    );
  }
  const view = parseDatabaseViewConfig(database.viewConfigJson).views.find(
    (candidate) => candidate.id === viewId,
  );
  if (!view) {
    setupError(
      "READBACK_UNAVAILABLE",
      "The saved view could not be read back.",
      500,
    );
  }
  return view;
}

async function readCanonicalViewConfig(
  tx: ReturnType<typeof getDb>,
  databaseId: string,
) {
  const [database] = await tx
    .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  if (!database) {
    setupError(
      "NOT_FOUND_OR_INACCESSIBLE",
      "The database is unavailable.",
      404,
    );
  }
  return parseDatabaseViewConfig(database.viewConfigJson);
}

export async function runUpdateContentDatabaseView(
  input: UpdateContentDatabaseViewAgentInput,
) {
  return runDatabaseSetupMutation({
    operation: `update-content-database-view.${input.operation}`,
    input,
    payload:
      input.operation === "create"
        ? { operation: input.operation, view: input.view }
        : {
            operation: input.operation,
            viewId: input.viewId,
            patch: input.patch,
          },
    apply: async (tx, context) => {
      const rawConfig = parseRawConfig(context.database.viewConfigJson);
      const normalized = parseDatabaseViewConfig(
        context.database.viewConfigJson,
      );
      const rawViews = Array.isArray(rawConfig.views)
        ? [...rawConfig.views]
        : normalized.views.map((view) => ({ ...view }));
      let viewId: string;
      let nextViews: unknown[];

      if (input.operation === "create") {
        validateTablePatch(input.view.config ?? {}, context.definitions);
        viewId = nanoid();
        nextViews = [
          ...rawViews,
          defaultTableView(
            viewId,
            input.view.name,
            input.view.config,
            input.view.icon,
          ),
        ];
      } else {
        const existing = normalized.views.find(
          (view) => view.id === input.viewId,
        );
        if (!existing) {
          setupError(
            "INVALID_VIEW_REFERENCE",
            "The saved view is unavailable.",
            404,
          );
        }
        const patchKeys = Object.keys(input.patch);
        let patch: Record<string, unknown> = input.patch;
        if (existing.type === "list") {
          const unsupported = patchKeys.find(
            (key) => !LIST_VIEW_PATCH_KEYS.has(key),
          );
          if (unsupported) {
            setupError(
              "UNSUPPORTED_SCHEMA_CHANGE",
              `List views accept only name, icon, itemLayout, and itemLayoutPreset here, not ${unsupported}.`,
              400,
            );
          }
          const { itemLayoutPreset: _preset, ...rest } = input.patch;
          const itemLayout = nextListItemLayout(
            input.patch,
            existing,
            context.definitions,
          );
          patch = itemLayout === undefined ? rest : { ...rest, itemLayout };
        } else if (existing.type === "table") {
          const listKey = patchKeys.find((key) => key in listPatchFields);
          if (listKey) {
            setupError(
              "UNSUPPORTED_SCHEMA_CHANGE",
              `${listKey} applies only to list views.`,
              400,
            );
          }
          validateTablePatch(input.patch, context.definitions);
        } else {
          setupError(
            "UNSUPPORTED_SCHEMA_CHANGE",
            "Ordinary database setup can update only table and list views.",
            400,
          );
        }
        viewId = existing.id;
        const index = rawViews.findIndex(
          (view) =>
            !!view &&
            typeof view === "object" &&
            (view as { id?: unknown }).id === viewId,
        );
        if (index < 0) {
          setupError(
            "READBACK_UNAVAILABLE",
            "The saved view could not be updated safely.",
            500,
          );
        }
        nextViews = [...rawViews];
        nextViews[index] = {
          ...(rawViews[index] as Record<string, unknown>),
          ...patch,
        };
      }

      const nextRaw: Record<string, unknown> = {
        ...rawConfig,
        views: nextViews,
      };
      if (normalized.activeViewId === viewId) {
        const selected = nextViews.find(
          (view) =>
            !!view &&
            typeof view === "object" &&
            (view as { id?: unknown }).id === viewId,
        ) as Partial<ContentDatabaseView> | undefined;
        nextRaw.sorts = selected?.sorts ?? normalized.sorts;
        nextRaw.filters = selected?.filters ?? normalized.filters;
        nextRaw.columnWidths =
          selected?.columnWidths ?? normalized.columnWidths;
      }
      const nextJson = JSON.stringify(nextRaw);
      const changed = nextJson !== (context.database.viewConfigJson ?? "");
      if (changed) {
        const userEmail = getRequestUserEmail();
        if (!userEmail)
          setupError("UNAUTHENTICATED", "Authentication is required.", 401);
        await syncPrivateViewIconReferences(tx, {
          databaseId: context.database.id,
          documentId: context.database.documentId,
          views: parseDatabaseViewConfig(nextJson).views,
          previousViews: normalized.views,
          ownerEmail: context.database.ownerEmail,
          orgId: context.database.orgId,
          userEmail,
        });
        await tx
          .update(schema.contentDatabases)
          .set({
            viewConfigJson: nextJson,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.contentDatabases.id, context.database.id));
      }
      return {
        outcome:
          input.operation === "create"
            ? ("created" as const)
            : changed
              ? ("updated" as const)
              : ("unchanged" as const),
        viewId,
        value: await readCanonicalView(tx, context.database.id, viewId),
      };
    },
  });
}

export async function runReplaceContentDatabaseViews(input: {
  target: UpdateContentDatabaseViewAgentInput["target"];
  expectedSchemaRevision: string;
  expectedConfigurationRevision: string;
  idempotencyKey: string;
  viewConfig: Partial<ContentDatabaseViewConfig> &
    Pick<ContentDatabaseViewConfig, "sorts" | "filters" | "columnWidths">;
}) {
  return runDatabaseSetupMutation({
    operation: "update-content-database-view.replace",
    input,
    payload: { operation: "replace", viewConfig: input.viewConfig },
    apply: async (tx, context) => {
      const rawConfig = parseRawConfig(context.database.viewConfigJson);
      const currentRawViews = Array.isArray(rawConfig.views)
        ? rawConfig.views
        : [];
      const desired = parseDatabaseViewConfig(JSON.stringify(input.viewConfig));
      const views = desired.views.map((view) => {
        const saved = currentRawViews.find(
          (candidate) =>
            !!candidate &&
            typeof candidate === "object" &&
            (candidate as { id?: unknown }).id === view.id,
        );
        return saved && typeof saved === "object"
          ? { ...(saved as Record<string, unknown>), ...view }
          : view;
      });
      const nextRaw: Record<string, unknown> = {
        ...rawConfig,
        activeViewId: desired.activeViewId,
        views,
        sorts: desired.sorts,
        filters: desired.filters,
        columnWidths: desired.columnWidths,
      };
      const nextJson = JSON.stringify(nextRaw);
      const changed = nextJson !== (context.database.viewConfigJson ?? "");
      if (changed) {
        const userEmail = getRequestUserEmail();
        if (!userEmail)
          setupError("UNAUTHENTICATED", "Authentication is required.", 401);
        await syncPrivateViewIconReferences(tx, {
          databaseId: context.database.id,
          documentId: context.database.documentId,
          views: parseDatabaseViewConfig(nextJson).views,
          previousViews: parseDatabaseViewConfig(
            context.database.viewConfigJson,
          ).views,
          ownerEmail: context.database.ownerEmail,
          orgId: context.database.orgId,
          userEmail,
        });
        await tx
          .update(schema.contentDatabases)
          .set({
            viewConfigJson: nextJson,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.contentDatabases.id, context.database.id));
      }
      return {
        outcome: changed ? ("updated" as const) : ("unchanged" as const),
        value: await readCanonicalViewConfig(tx, context.database.id),
      };
    },
  });
}

export function filterIsCompatible(
  filter: ContentDatabaseFilter,
  type: DocumentPropertyType,
) {
  return (operatorsByType[type] ?? defaultOperators).includes(filter.operator);
}
