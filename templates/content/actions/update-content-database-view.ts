import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withSavedTableColumnPresentation } from "../shared/database-table-columns.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  refreshAfterSetup,
  setupAuditSummary,
  setupGuardSchema,
} from "./_database-setup-mutation.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import {
  runReplaceContentDatabaseViews,
  runUpdateContentDatabaseView,
  updateContentDatabaseViewAgentSchema,
} from "./_database-view-setup.js";
import {
  parseDatabaseViewConfig,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

const sortSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const filterSchema = z
  .object({
    key: z.string(),
    label: z.string(),
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
    filterGroupId: z.string().optional(),
    parentFilterGroupId: z.string().optional(),
  })
  .strict();

const columnCalculationSchema = z.enum([
  "count_all",
  "count_values",
  "count_empty",
  "count_unique",
  "percent_filled",
  "percent_empty",
  "count_checked",
  "count_unchecked",
  "percent_checked",
  "percent_unchecked",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "range",
  "date_range",
]);

const formQuestionSchema = z
  .object({
    key: z.string().min(1),
    enabled: z.boolean().default(true),
    required: z.boolean().default(false),
  })
  .strict();

const viewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z
      .enum([
        "table",
        "board",
        "list",
        "gallery",
        "calendar",
        "timeline",
        "form",
        "sidebar",
      ])
      .transform((type) => (type === "sidebar" ? "table" : type))
      .default("table"),
    sorts: z.array(sortSchema).default([]),
    filters: z.array(filterSchema).default([]),
    filterMode: z.enum(["and", "or"]).default("and"),
    columnWidths: z.record(z.string(), z.number()).default({}),
    groupByPropertyId: z.string().nullable().optional(),
    datePropertyId: z.string().nullable().optional(),
    endDatePropertyId: z.string().nullable().optional(),
    hiddenPropertyIds: z.array(z.string()).default([]),
    propertyOrderIds: z.array(z.string()).default([]),
    tableColumnOrderIds: z.array(z.string()).optional(),
    collapsedGroupIds: z.array(z.string()).default([]),
    hideEmptyGroups: z.boolean().default(false),
    calculations: z.record(z.string(), columnCalculationSchema).default({}),
    wrapCells: z.boolean().default(false),
    columnWrapOverrides: z.record(z.string().min(1), z.boolean()).optional(),
    frozenThroughColumnId: z.string().min(1).nullable().optional(),
    rowDensity: z
      .enum(["compact", "default", "comfortable"])
      .default("default"),
    openPagesIn: z.enum(["preview", "full_page"]).default("preview"),
    formQuestions: z.array(formQuestionSchema).default([]),
  })
  .strict();

const legacyUpdateContentDatabaseViewSchema = z
  .object({
    databaseId: z.string().describe("Database ID"),
    viewConfig: z
      .object({
        activeViewId: z.string().optional(),
        views: z.array(viewSchema).optional(),
        sorts: z.array(sortSchema).default([]),
        filters: z.array(filterSchema).default([]),
        columnWidths: z.record(z.string(), z.number()).default({}),
      })
      .strict()
      .describe("Saved database table view settings"),
  })
  .strict();

const guardedViewReplacementSchema = setupGuardSchema
  .extend({
    operation: z.literal("replace"),
    expectedConfigurationRevision: z.string().min(1),
    viewConfig: legacyUpdateContentDatabaseViewSchema.shape.viewConfig,
  })
  .strict();

export default defineAction({
  description:
    "Create one named ordinary table view or sparsely update one exact saved table view using stable property IDs, fresh schema and configuration revisions, and an idempotency key.",
  mcpTool: true,
  mcpApp: { structuredContent: true },
  agentInputSchema: updateContentDatabaseViewAgentSchema,
  schema: z.union([
    updateContentDatabaseViewAgentSchema,
    guardedViewReplacementSchema,
    legacyUpdateContentDatabaseViewSchema,
  ]),
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "content-database",
      id: "operation" in args ? args.target.databaseId : args.databaseId,
      visibility: "private",
    }),
    summary: (_args, result) =>
      setupAuditSummary(result, "Updated Content database views"),
  },
  run: async (args, context) => {
    if (context?.caller === "mcp") {
      updateContentDatabaseViewAgentSchema.parse(args);
    }
    if ("operation" in args) {
      const result =
        args.operation === "replace"
          ? await runReplaceContentDatabaseViews(args)
          : await runUpdateContentDatabaseView(args);
      await refreshAfterSetup(result.receipt);
      return result;
    }
    const { databaseId, viewConfig } = args;
    const db = getDb();
    const [database] = await db
      .select({ documentId: schema.contentDatabases.documentId })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found`);

    await assertAccess("document", database.documentId, "editor");

    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        databaseId,
      );
      const [lockedDatabase] = await tx
        .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.id, databaseId),
            isNull(schema.contentDatabases.deletedAt),
          ),
        );
      if (!lockedDatabase)
        throw new Error(`Database "${databaseId}" not found`);

      const currentViewConfig = parseDatabaseViewConfig(
        lockedDatabase.viewConfigJson,
      );
      const nextViewConfig = {
        ...viewConfig,
        views: viewConfig.views?.map((view) =>
          withSavedTableColumnPresentation(view, currentViewConfig.views),
        ),
      };

      await tx
        .update(schema.contentDatabases)
        .set({
          viewConfigJson: serializeDatabaseViewConfig(nextViewConfig),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contentDatabases.id, databaseId));
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return getContentDatabaseResponse(databaseId, { limit: 100, offset: 0 });
  },
  link: ({ result }) => {
    const receipt = (
      result as {
        receipt?: {
          viewId?: string;
          target?: { databaseDocumentId?: string };
        };
      } | null
    )?.receipt;
    const documentId = receipt?.target?.databaseDocumentId;
    if (!documentId || !receipt?.viewId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        to: `/page/${encodeURIComponent(documentId)}?viewId=${encodeURIComponent(receipt.viewId)}`,
        params: { documentId, viewId: receipt.viewId },
      }),
      label: "Open in Content",
      view: "editor",
    };
  },
});
