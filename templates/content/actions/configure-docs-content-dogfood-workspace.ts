import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseSource,
  ContentDatabaseView,
  ContentDatabaseViewConfig,
} from "../shared/api.js";
import {
  parsePropertyOptions,
  type DocumentPropertyOption,
  type DocumentPropertyOptions,
  type DocumentPropertyOptionColor,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { getAllContentDatabaseSourceSnapshots } from "./_database-source-utils.js";
import {
  getContentDatabaseResponse,
  getDatabaseByDocumentId,
} from "./_database-utils.js";
import {
  getDatabaseById,
  nanoid,
  normalizedValueJson,
  optionsForNewProperty,
  parseDatabaseViewConfig,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";
import { createContentDatabaseRecord } from "./create-content-database.js";

const WORKSPACE_TITLE = "Docs/content dogfood workspace";
type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;

const dogfoodWorkspaceSchema = z
  .object({
    databaseId: z
      .string()
      .optional()
      .describe("Existing content database to configure"),
    documentId: z
      .string()
      .optional()
      .describe("Existing database page, or document to convert to a database"),
    title: z
      .string()
      .optional()
      .describe("Title to use when a new database is created"),
    updateRowStatusFields: z
      .boolean()
      .default(true)
      .describe(
        "Refresh source status, safe-to-edit, needs-review, and unsupported-block fields from current source data",
      ),
  })
  .refine((args) => !(args.databaseId && args.documentId), {
    message: "Pass databaseId or documentId, not both.",
  });

type DogfoodPropertySpec = {
  key: DogfoodPropertyKey;
  name: string;
  type: DocumentPropertyType;
  visibility?: "always_show" | "hide_when_empty" | "always_hide";
  options?: DocumentPropertyOptions;
};

type DogfoodPropertyKey =
  | "persona"
  | "topic"
  | "useCase"
  | "seoAngle"
  | "owner"
  | "sourceStatus"
  | "safeToEdit"
  | "needsReview"
  | "unsupportedBlocks"
  | "unsupportedBlockNotes";

type PropertyIdMap = Record<DogfoodPropertyKey, string>;

const sourceStatusOptions = [
  option("fresh", "Fresh", "green"),
  option("stale", "Stale", "yellow"),
  option("error", "Error", "red"),
  option("unknown", "Unknown", "gray"),
  option("no-source", "No source", "gray"),
];

const safeToEditOptions = [
  option("safe-local-draft", "Safe local draft", "green"),
  option("review-first", "Review first", "yellow"),
  option("blocked", "Blocked", "red"),
  option("read-only", "Read only", "gray"),
];

export const docsContentDogfoodPropertySpecs: DogfoodPropertySpec[] = [
  {
    key: "persona",
    name: "Persona",
    type: "multi_select",
    options: {
      options: [
        option("developer", "Developer", "blue"),
        option("docs-author", "Docs author", "green"),
        option("product", "Product", "purple"),
        option("sales", "Sales", "orange"),
        option("admin", "Admin", "gray"),
      ],
    },
  },
  {
    key: "topic",
    name: "Topic",
    type: "multi_select",
    options: {
      options: [
        option("content", "Content", "blue"),
        option("builder-cms", "Builder CMS", "purple"),
        option("agents", "Agents", "green"),
        option("templates", "Templates", "yellow"),
        option("workflow", "Workflow", "orange"),
      ],
    },
  },
  {
    key: "useCase",
    name: "Use case",
    type: "multi_select",
    options: {
      options: [
        option("docs-review", "Docs review", "blue"),
        option("content-ops", "Content ops", "green"),
        option("enablement", "Enablement", "orange"),
        option("seo", "SEO", "yellow"),
        option("migration", "Migration", "purple"),
      ],
    },
  },
  { key: "seoAngle", name: "SEO angle", type: "text" },
  { key: "owner", name: "Owner", type: "person" },
  {
    key: "sourceStatus",
    name: "Source status",
    type: "status",
    options: { options: sourceStatusOptions },
  },
  {
    key: "safeToEdit",
    name: "Safe to edit",
    type: "status",
    options: { options: safeToEditOptions },
  },
  { key: "needsReview", name: "Needs review", type: "checkbox" },
  { key: "unsupportedBlocks", name: "Unsupported blocks", type: "checkbox" },
  {
    key: "unsupportedBlockNotes",
    name: "Unsupported block notes",
    type: "text",
    visibility: "hide_when_empty",
  },
];

export default defineAction({
  description:
    "Create or upgrade an internal Builder docs/blog dogfood workspace with practical content-operations fields, source status fields, and saved views.",
  schema: dogfoodWorkspaceSchema,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Open dogfood workspace",
      description: "Open the docs/content dogfood workspace in Content.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async (args) => {
    const result = await configureDocsContentDogfoodWorkspace(args);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
  link: ({ result }) => {
    const documentId = (result as { database?: { documentId?: string } } | null)
      ?.database?.documentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open dogfood workspace",
      view: "editor",
    };
  },
});

export async function configureDocsContentDogfoodWorkspace(args: {
  databaseId?: string;
  documentId?: string;
  title?: string;
  updateRowStatusFields?: boolean;
}): Promise<ContentDatabaseResponse & { dogfoodWorkspace: object }> {
  const db = getDb();
  const database = await resolveDogfoodDatabase(args);
  await assertAccess("document", database.documentId, "editor");

  const now = new Date().toISOString();
  const propertyIds = await upsertDogfoodProperties({
    database,
    now,
  });

  const dogfoodViewConfig = buildDocsContentDogfoodViewConfig(propertyIds);
  const viewConfig = mergeDogfoodViews(
    parseDatabaseViewConfig(database.viewConfigJson),
    dogfoodViewConfig,
  );
  await db
    .update(schema.contentDatabases)
    .set({
      viewConfigJson: serializeDatabaseViewConfig(viewConfig),
      updatedAt: now,
    })
    .where(eq(schema.contentDatabases.id, database.id));

  const rowStatusSummary =
    args.updateRowStatusFields === false
      ? { updatedRows: 0, skipped: true }
      : await refreshDogfoodRowStatuses({
          database,
          propertyIds,
          now,
        });

  return {
    ...(await getContentDatabaseResponse(database.id)),
    dogfoodWorkspace: {
      propertyIds,
      views: viewConfig.views.map((view) => ({
        id: view.id,
        name: view.name,
        type: view.type,
      })),
      rowStatusSummary,
      caveat:
        "This configures the dogfood workspace fields and views; scale, bulk-update, and component-mapping guarantees remain in their own PR lanes.",
    },
  };
}

async function resolveDogfoodDatabase(args: {
  databaseId?: string;
  documentId?: string;
  title?: string;
}) {
  if (args.databaseId) {
    const database = await getDatabaseById(args.databaseId);
    if (!database) throw new Error(`Database "${args.databaseId}" not found`);
    return database;
  }

  if (args.documentId) {
    const existing = await getDatabaseByDocumentId(args.documentId);
    if (existing) return existing;
    const databaseId = await createContentDatabaseRecord({
      documentId: args.documentId,
      title: args.title ?? WORKSPACE_TITLE,
    });
    const database = await getDatabaseById(databaseId);
    if (!database) throw new Error(`Database "${databaseId}" not found`);
    return database;
  }

  const existing = await findExistingDogfoodDatabase(
    args.title ?? WORKSPACE_TITLE,
  );
  if (existing) return existing;

  const databaseId = await createContentDatabaseRecord({
    title: args.title ?? WORKSPACE_TITLE,
  });
  const database = await getDatabaseById(databaseId);
  if (!database) throw new Error(`Database "${databaseId}" not found`);
  return database;
}

async function upsertDogfoodProperties(args: {
  database: ContentDatabaseRow;
  now: string;
}): Promise<PropertyIdMap> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.database.id))
    .orderBy(asc(schema.documentPropertyDefinitions.position));
  const byName = new Map(existing.map((property) => [property.name, property]));
  const [maxPosition] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.database.id));
  let nextPosition = (maxPosition?.max ?? -1) + 1;
  const ids = {} as PropertyIdMap;

  for (const spec of docsContentDogfoodPropertySpecs) {
    const optionsJson = optionsForSpec(
      spec,
      byName.get(spec.name)?.optionsJson,
    );
    const existingProperty = byName.get(spec.name);
    if (existingProperty) {
      ids[spec.key] = existingProperty.id;
      await db
        .update(schema.documentPropertyDefinitions)
        .set({
          type: spec.type,
          visibility: spec.visibility ?? "always_show",
          optionsJson,
          updatedAt: args.now,
        })
        .where(eq(schema.documentPropertyDefinitions.id, existingProperty.id));
      continue;
    }

    const id = nanoid();
    ids[spec.key] = id;
    await db.insert(schema.documentPropertyDefinitions).values({
      id,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId ?? null,
      databaseId: args.database.id,
      name: spec.name,
      type: spec.type,
      visibility: spec.visibility ?? "always_show",
      optionsJson,
      position: nextPosition,
      createdAt: args.now,
      updatedAt: args.now,
    });
    nextPosition += 1;
  }

  return ids;
}

async function findExistingDogfoodDatabase(title: string) {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) return null;
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.ownerEmail, ownerEmail),
        eq(schema.contentDatabases.title, title),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .orderBy(
      asc(schema.contentDatabases.createdAt),
      asc(schema.contentDatabases.id),
    );
  if (!database) return null;

  try {
    await assertAccess("document", database.documentId, "editor");
    return database;
  } catch {
    return null;
  }
}

function optionsForSpec(
  spec: DogfoodPropertySpec,
  existingOptionsJson?: string | null,
) {
  const defaultJson = optionsForNewProperty(spec.type, spec.options);
  const existing = parsePropertyOptions(existingOptionsJson);
  if (!spec.options?.options?.length || !existing.options?.length) {
    return defaultJson;
  }
  return JSON.stringify({
    ...spec.options,
    options: mergeOptions(spec.options.options, existing.options),
  });
}

function mergeOptions(
  defaults: DocumentPropertyOption[],
  existing: DocumentPropertyOption[],
) {
  const seen = new Set(defaults.map((item) => item.id));
  return [
    ...defaults,
    ...existing.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

export function buildDocsContentDogfoodViewConfig(
  propertyIds: PropertyIdMap,
): ContentDatabaseViewConfig {
  const propertyOrderIds = [
    "name",
    propertyIds.sourceStatus,
    propertyIds.safeToEdit,
    propertyIds.needsReview,
    propertyIds.unsupportedBlocks,
    propertyIds.persona,
    propertyIds.topic,
    propertyIds.useCase,
    propertyIds.seoAngle,
    propertyIds.owner,
    propertyIds.unsupportedBlockNotes,
  ];
  const widths = {
    name: 280,
    [propertyIds.sourceStatus]: 150,
    [propertyIds.safeToEdit]: 170,
    [propertyIds.needsReview]: 120,
    [propertyIds.unsupportedBlocks]: 150,
    [propertyIds.persona]: 180,
    [propertyIds.topic]: 200,
    [propertyIds.useCase]: 200,
    [propertyIds.seoAngle]: 260,
    [propertyIds.owner]: 160,
    [propertyIds.unsupportedBlockNotes]: 320,
  };
  const views: ContentDatabaseView[] = [
    {
      id: "docs-content-ops",
      name: "Docs/blog ops",
      type: "table",
      sorts: [{ key: "name", label: "Name", direction: "asc" }],
      filters: [],
      filterMode: "and",
      columnWidths: widths,
      propertyOrderIds,
      hiddenPropertyIds: [],
      collapsedGroupIds: [],
      hideEmptyGroups: false,
      calculations: {
        [propertyIds.sourceStatus]: "count_values",
        [propertyIds.safeToEdit]: "count_values",
        [propertyIds.needsReview]: "count_checked",
        [propertyIds.unsupportedBlocks]: "count_checked",
      },
      wrapCells: true,
      rowDensity: "compact",
      openPagesIn: "preview",
    },
    tableView("Needs review", "docs-content-needs-review", propertyOrderIds, [
      checkboxFilter(propertyIds.needsReview, "Needs review"),
      checkboxFilter(propertyIds.unsupportedBlocks, "Unsupported blocks"),
      statusFilter(propertyIds.safeToEdit, "Safe to edit", "review-first"),
      statusFilter(propertyIds.safeToEdit, "Safe to edit", "blocked"),
    ]),
    tableView("Safe local drafts", "docs-content-safe", propertyOrderIds, [
      statusFilter(propertyIds.safeToEdit, "Safe to edit", "safe-local-draft"),
    ]),
    tableView(
      "Unsupported blocks",
      "docs-content-unsupported",
      propertyOrderIds,
      [checkboxFilter(propertyIds.unsupportedBlocks, "Unsupported blocks")],
    ),
    {
      ...tableView(
        "Safe-to-edit board",
        "docs-content-safe-board",
        propertyOrderIds,
      ),
      type: "board",
      groupByPropertyId: propertyIds.safeToEdit,
      hideEmptyGroups: true,
    },
  ];

  return {
    activeViewId: views[0].id,
    views,
    sorts: views[0].sorts,
    filters: views[0].filters,
    columnWidths: views[0].columnWidths,
  };
}

export function mergeDogfoodViews(
  existing: ContentDatabaseViewConfig,
  dogfood: ContentDatabaseViewConfig,
): ContentDatabaseViewConfig {
  const dogfoodById = new Map(dogfood.views.map((view) => [view.id, view]));
  const mergedViews = existing.views.map(
    (view) => dogfoodById.get(view.id) ?? view,
  );
  const existingIds = new Set(mergedViews.map((view) => view.id));
  for (const view of dogfood.views) {
    if (!existingIds.has(view.id)) mergedViews.push(view);
  }
  const activeViewId = mergedViews.some(
    (view) => view.id === existing.activeViewId,
  )
    ? existing.activeViewId
    : dogfood.activeViewId;
  const activeView =
    mergedViews.find((view) => view.id === activeViewId) ??
    dogfood.views[0] ??
    mergedViews[0];

  return {
    activeViewId: activeView.id,
    views: mergedViews,
    sorts: activeView.sorts,
    filters: activeView.filters,
    columnWidths: activeView.columnWidths,
  };
}

function tableView(
  name: string,
  id: string,
  propertyOrderIds: string[],
  filters: ContentDatabaseFilter[] = [],
): ContentDatabaseView {
  return {
    id,
    name,
    type: "table",
    sorts: [{ key: "name", label: "Name", direction: "asc" }],
    filters,
    filterMode: filters.length > 1 ? "or" : "and",
    columnWidths: {},
    propertyOrderIds,
    hiddenPropertyIds: [],
    collapsedGroupIds: [],
    hideEmptyGroups: false,
    calculations: {},
    wrapCells: true,
    rowDensity: "compact",
    openPagesIn: "preview",
  };
}

function checkboxFilter(key: string, label: string): ContentDatabaseFilter {
  return { key, label, operator: "is_checked", value: "" };
}

function statusFilter(
  key: string,
  label: string,
  value: string,
): ContentDatabaseFilter {
  return { key, label, operator: "equals", value };
}

async function refreshDogfoodRowStatuses(args: {
  database: ContentDatabaseRow;
  propertyIds: PropertyIdMap;
  now: string;
}) {
  const db = getDb();
  const items = await db
    .select()
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, args.database.id))
    .orderBy(asc(schema.contentDatabaseItems.position));
  const sources = await getAllContentDatabaseSourceSnapshots(args.database);
  const source =
    sources.find((item) => item.sourceType === "builder-cms") ?? null;
  let updatedRows = 0;
  let skippedRows = 0;
  const statusValues: Array<{
    documentId: string;
    ownerEmail: string;
    propertyId: string;
    type: DocumentPropertyType;
    value: DocumentPropertyValue;
  }> = [];

  for (const item of items) {
    const access = await assertAccess("document", item.documentId, "editor")
      .then((result) => result)
      .catch(() => null);
    if (!access) {
      skippedRows += 1;
      continue;
    }

    const status = deriveDogfoodRowStatus({
      item: {
        document: { id: item.documentId },
        bodyHydration: {
          status:
            item.bodyHydrationStatus === "pending" ||
            item.bodyHydrationStatus === "hydrating" ||
            item.bodyHydrationStatus === "error"
              ? item.bodyHydrationStatus
              : "hydrated",
          error: item.bodyHydrationError,
        },
      },
      source,
    });

    statusValues.push({
      documentId: item.documentId,
      ownerEmail: access.resource.ownerEmail,
      propertyId: args.propertyIds.sourceStatus,
      type: "status",
      value: status.sourceStatus,
    });
    statusValues.push({
      documentId: item.documentId,
      ownerEmail: access.resource.ownerEmail,
      propertyId: args.propertyIds.safeToEdit,
      type: "status",
      value: status.safeToEdit,
    });
    statusValues.push({
      documentId: item.documentId,
      ownerEmail: access.resource.ownerEmail,
      propertyId: args.propertyIds.needsReview,
      type: "checkbox",
      value: status.needsReview,
    });
    statusValues.push({
      documentId: item.documentId,
      ownerEmail: access.resource.ownerEmail,
      propertyId: args.propertyIds.unsupportedBlocks,
      type: "checkbox",
      value: status.unsupportedBlocks,
    });
    statusValues.push({
      documentId: item.documentId,
      ownerEmail: access.resource.ownerEmail,
      propertyId: args.propertyIds.unsupportedBlockNotes,
      type: "text",
      value: status.unsupportedBlockNotes,
    });
    updatedRows += 1;
  }

  await setPropertyValues({
    values: statusValues,
    propertyIds: [
      args.propertyIds.sourceStatus,
      args.propertyIds.safeToEdit,
      args.propertyIds.needsReview,
      args.propertyIds.unsupportedBlocks,
      args.propertyIds.unsupportedBlockNotes,
    ],
    now: args.now,
  });

  return {
    updatedRows,
    skippedRows,
    sourceId: source?.id ?? null,
    sourceTable: source?.sourceTable ?? null,
  };
}

type DogfoodStatusInput = {
  item: {
    document: Pick<ContentDatabaseItem["document"], "id">;
    bodyHydration?: {
      status?: string | null;
      error?: string | null;
    };
  };
  source: ContentDatabaseSource | null;
};

export function deriveDogfoodRowStatus(args: DogfoodStatusInput) {
  const row = args.source?.rows.find(
    (candidate) => candidate.documentId === args.item.document.id,
  );
  const openChangeSets =
    args.source?.changeSets.filter(
      (changeSet) =>
        changeSet.documentId === args.item.document.id &&
        changeSet.state !== "applied" &&
        changeSet.state !== "rejected",
    ) ?? [];
  const unsupportedReasons = unsupportedBlockReasons(args, openChangeSets);
  const hasHydrationError = args.item.bodyHydration?.status === "error";
  const hasSourceError =
    row?.syncState === "error" || args.source?.syncState === "error";
  const hasConflict = openChangeSets.some(
    (changeSet) => changeSet.conflictState === "source_changed",
  );
  const needsReview =
    openChangeSets.length > 0 ||
    hasHydrationError ||
    hasSourceError ||
    hasConflict ||
    unsupportedReasons.length > 0;
  const sourceStatus = sourceStatusForRow(args.source, row, hasHydrationError);
  const unsupportedBlocks = unsupportedReasons.length > 0;
  const safeToEdit = safeToEditForRow({
    source: args.source,
    sourceStatus,
    needsReview,
    unsupportedBlocks,
    hasHydrationError,
    hasConflict,
  });

  return {
    sourceStatus,
    safeToEdit,
    needsReview,
    unsupportedBlocks,
    unsupportedBlockNotes: unsupportedReasons.join("; "),
  };
}

function sourceStatusForRow(
  source: ContentDatabaseSource | null,
  row: ContentDatabaseSource["rows"][number] | undefined,
  hasHydrationError: boolean,
) {
  if (!source || !row) return "no-source";
  if (
    hasHydrationError ||
    row.syncState === "error" ||
    source.syncState === "error"
  ) {
    return "error";
  }
  if (row.freshness === "stale" || source.freshness === "stale") return "stale";
  if (row.freshness === "fresh" || source.freshness === "fresh") return "fresh";
  return "unknown";
}

function safeToEditForRow(args: {
  source: ContentDatabaseSource | null;
  sourceStatus: string;
  needsReview: boolean;
  unsupportedBlocks: boolean;
  hasHydrationError: boolean;
  hasConflict: boolean;
}) {
  if (!args.source) return "read-only";
  if (
    args.hasHydrationError ||
    args.hasConflict ||
    args.unsupportedBlocks ||
    args.sourceStatus === "error"
  ) {
    return "blocked";
  }
  if (
    args.needsReview ||
    args.sourceStatus === "stale" ||
    args.sourceStatus === "unknown"
  ) {
    return "review-first";
  }
  return "safe-local-draft";
}

function unsupportedBlockReasons(
  args: DogfoodStatusInput,
  openChangeSets: ContentDatabaseSource["changeSets"],
) {
  const reasons = new Set<string>();
  const hydrationError = args.item.bodyHydration?.error ?? "";
  if (mentionsUnsupportedBlock(hydrationError)) reasons.add(hydrationError);

  for (const changeSet of openChangeSets) {
    for (const warning of changeSet.bodyChange?.warnings ?? []) {
      if (mentionsUnsupportedBlock(warning)) reasons.add(warning);
    }
  }

  return Array.from(reasons);
}

function mentionsUnsupportedBlock(value: string) {
  return /unsupported|unmodeled|raw sidecar/i.test(value);
}

async function setPropertyValues(args: {
  values: Array<{
    documentId: string;
    ownerEmail: string;
    propertyId: string;
    type: DocumentPropertyType;
    value: DocumentPropertyValue;
  }>;
  propertyIds: string[];
  now: string;
}) {
  if (!args.values.length) return;
  const db = getDb();
  const documentIds = Array.from(
    new Set(args.values.map((value) => value.documentId)),
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.documentPropertyValues)
      .where(
        and(
          inArray(schema.documentPropertyValues.documentId, documentIds),
          inArray(schema.documentPropertyValues.propertyId, args.propertyIds),
        ),
      );

    await tx.insert(schema.documentPropertyValues).values(
      args.values.map((value) => ({
        id: nanoid(),
        ownerEmail: value.ownerEmail,
        documentId: value.documentId,
        propertyId: value.propertyId,
        valueJson: normalizedValueJson(value.type, value.value),
        createdAt: args.now,
        updatedAt: args.now,
      })),
    );
  });
}

function option(
  id: string,
  name: string,
  color: DocumentPropertyOptionColor,
): DocumentPropertyOption {
  return { id, name, color };
}
