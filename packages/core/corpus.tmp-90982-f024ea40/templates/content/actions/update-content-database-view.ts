import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { serializeDatabaseViewConfig } from "./_property-utils.js";

const sortSchema = z.object({
  key: z.string(),
  label: z.string(),
  direction: z.enum(["asc", "desc"]),
});

const filterSchema = z.object({
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
});

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

const formQuestionSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
});

const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z
    .enum(["table", "board", "list", "gallery", "calendar", "timeline", "form"])
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
  collapsedGroupIds: z.array(z.string()).default([]),
  hideEmptyGroups: z.boolean().default(false),
  calculations: z.record(z.string(), columnCalculationSchema).default({}),
  wrapCells: z.boolean().default(false),
  rowDensity: z.enum(["compact", "default", "comfortable"]).default("default"),
  openPagesIn: z.enum(["preview", "full_page"]).default("preview"),
  formQuestions: z.array(formQuestionSchema).default([]),
});

export default defineAction({
  description:
    "Update saved database views, sorts, filters, property order, hidden properties, and view-specific settings for a content database.",
  schema: z.object({
    databaseId: z.string().describe("Database ID"),
    viewConfig: z
      .object({
        activeViewId: z.string().optional(),
        views: z.array(viewSchema).optional(),
        sorts: z.array(sortSchema).default([]),
        filters: z.array(filterSchema).default([]),
        columnWidths: z.record(z.string(), z.number()).default({}),
      })
      .describe("Saved database table view settings"),
  }),
  run: async ({ databaseId, viewConfig }) => {
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found`);

    await assertAccess("document", database.documentId, "editor");

    await db
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: serializeDatabaseViewConfig(viewConfig),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDatabases.id, databaseId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return getContentDatabaseResponse(databaseId);
  },
});
