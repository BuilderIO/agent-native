import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { alias } from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseNavigationPageResponse,
  ContentDatabaseNavigationSort,
} from "../shared/api.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

const CURSOR_VERSION = 1;

type NavigationCursor = {
  version: typeof CURSOR_VERSION;
  databaseId: string;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId: string | null;
  orderHash: string | null;
  revision: string;
  configHash: string;
  sortValue: string | number;
  position?: number;
  itemId: string;
};

function invalidCursor(): never {
  fail("The Files navigation cursor is invalid or stale.", {
    errorCode: "invalid_navigation_cursor",
    statusCode: 400,
  });
}

function decodeCursor(value: string): NavigationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.version !== CURSOR_VERSION ||
      typeof parsed.databaseId !== "string" ||
      !(parsed.parentId === null || typeof parsed.parentId === "string") ||
      !["custom", "name", "created", "last_edited"].includes(parsed.sort) ||
      !(parsed.viewId === null || typeof parsed.viewId === "string") ||
      !(parsed.orderHash === null || typeof parsed.orderHash === "string") ||
      typeof parsed.revision !== "string" ||
      typeof parsed.configHash !== "string" ||
      !(
        typeof parsed.sortValue === "string" ||
        typeof parsed.sortValue === "number"
      ) ||
      typeof parsed.itemId !== "string" ||
      (parsed.sort === "custom" &&
        (typeof parsed.sortValue !== "number" ||
          typeof parsed.position !== "number"))
    ) {
      invalidCursor();
    }
    return parsed as NavigationCursor;
  } catch {
    return invalidCursor();
  }
}

function encodeCursor(cursor: NavigationCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function orderFingerprint(itemIds: string[]) {
  return createHash("sha256").update(JSON.stringify(itemIds)).digest("hex");
}

function selectedFilterValues(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [trimmed];
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [trimmed];
  }
}

function activeNavigationFilter(filter: ContentDatabaseFilter) {
  return (
    ["is_empty", "is_not_empty", "is_checked", "is_unchecked"].includes(
      filter.operator,
    ) || selectedFilterValues(filter.value).length > 0
  );
}

function textFilterSql(
  expression: SQL<string | null>,
  filter: ContentDatabaseFilter,
): SQL | undefined {
  const values = selectedFilterValues(filter.value).map((value) =>
    value.toLowerCase(),
  );
  const normalized = sql<string>`lower(coalesce(${expression}, ''))`;
  if (filter.operator === "is_empty") return sql`${normalized} = ''`;
  if (filter.operator === "is_not_empty") return sql`${normalized} <> ''`;
  if (filter.operator === "equals") return sql`${normalized} = ${values[0]}`;
  if (filter.operator === "does_not_equal")
    return sql`${normalized} <> ${values[0]}`;
  if (filter.operator === "contains")
    return sql`position(${values[0]} in ${normalized}) > 0`;
  return undefined;
}

function dateFilterSql(
  expression: SQL<string>,
  filter: ContentDatabaseFilter,
): SQL | undefined {
  const values = selectedFilterValues(filter.value);
  if (filter.operator === "is_empty")
    return sql`coalesce(${expression}, '') = ''`;
  if (filter.operator === "is_not_empty")
    return sql`coalesce(${expression}, '') <> ''`;
  if (filter.operator === "before") return sql`${expression} < ${values[0]}`;
  if (filter.operator === "after") return sql`${expression} > ${values[0]}`;
  if (filter.operator === "between" && values.length >= 2) {
    const [start, end] =
      values[0]! <= values[1]! ? values : [values[1]!, values[0]!];
    return and(sql`${expression} >= ${start}`, sql`${expression} <= ${end}`);
  }
  return undefined;
}

async function navigationFilterSql(args: {
  databaseId: string;
  filters: ContentDatabaseFilter[];
  filterMode: ContentDatabaseFilterMode;
  document: {
    id: SQL<string>;
    title: SQL<string>;
    parentId: SQL<string | null>;
    ownerEmail: SQL<string>;
    createdAt: SQL<string>;
    updatedAt: SQL<string>;
  };
}) {
  const filters = args.filters.filter(activeNavigationFilter);
  if (filters.length === 0) return undefined;
  const propertyIds = [
    ...new Set(
      filters.map((filter) => filter.key).filter((key) => key !== "name"),
    ),
  ];
  const definitions = propertyIds.length
    ? await getDb()
        .select({
          id: schema.documentPropertyDefinitions.id,
          name: schema.documentPropertyDefinitions.name,
          type: schema.documentPropertyDefinitions.type,
          systemRole: schema.documentPropertyDefinitions.systemRole,
        })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, args.databaseId),
            inArray(schema.documentPropertyDefinitions.id, propertyIds),
          ),
        )
    : [];
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );

  const leaves = filters.map((filter) => {
    let predicate: SQL | undefined;
    if (filter.key === "name") {
      predicate = textFilterSql(args.document.title, filter);
    } else {
      const definition = definitionById.get(filter.key);
      if (!definition) {
        fail(
          `The Files view filter property "${filter.label}" is unavailable.`,
          {
            errorCode: "unsupported_navigation_filter_property",
            statusCode: 400,
          },
        );
      }
      if (definition.systemRole === "files_parent") {
        predicate = textFilterSql(args.document.parentId, filter);
      } else if (definition.systemRole === "files_source") {
        const selected = selectedFilterValues(filter.value);
        const sourceMatch = selected.length
          ? exists(
              getDb()
                .select({ id: schema.contentDatabaseSourceRows.id })
                .from(schema.contentDatabaseSourceRows)
                .where(
                  and(
                    eq(
                      schema.contentDatabaseSourceRows.documentId,
                      args.document.id,
                    ),
                    inArray(
                      schema.contentDatabaseSourceRows.sourceId,
                      selected,
                    ),
                  ),
                ),
            )
          : undefined;
        const hasSource = exists(
          getDb()
            .select({ id: schema.contentDatabaseSourceRows.id })
            .from(schema.contentDatabaseSourceRows)
            .where(
              eq(schema.contentDatabaseSourceRows.documentId, args.document.id),
            ),
        );
        const matches = selected.includes("local")
          ? sourceMatch
            ? or(sourceMatch, sql`not ${hasSource}`)
            : sql`not ${hasSource}`
          : sourceMatch;
        if (filter.operator === "equals" || filter.operator === "contains")
          predicate = matches;
        else if (filter.operator === "does_not_equal")
          predicate = matches ? sql`not (${matches})` : undefined;
        else if (filter.operator === "is_empty") predicate = sql`false`;
        else if (filter.operator === "is_not_empty") predicate = sql`true`;
      } else if (definition.type === "created_time") {
        predicate = dateFilterSql(args.document.createdAt, filter);
      } else if (definition.type === "last_edited_time") {
        predicate = dateFilterSql(args.document.updatedAt, filter);
      } else if (
        definition.type === "created_by" ||
        definition.type === "last_edited_by"
      ) {
        predicate = textFilterSql(args.document.ownerEmail, filter);
      }
    }
    if (!predicate) {
      fail(
        `The Files view filter on "${filter.label}" is not supported in navigation.`,
        {
          errorCode: "unsupported_navigation_filter_expression",
          statusCode: 400,
        },
      );
    }
    return { filter, predicate };
  });
  const roots = leaves.filter(({ filter }) => !filter.parentFilterGroupId);
  const groups = new Map<string, SQL[]>();
  for (const { filter, predicate } of leaves) {
    if (!filter.parentFilterGroupId || !filter.filterGroupId) continue;
    groups.set(filter.filterGroupId, [
      ...(groups.get(filter.filterGroupId) ?? []),
      predicate,
    ]);
  }
  const combine = (values: SQL[]): SQL =>
    (args.filterMode === "or" ? or(...values) : and(...values)) ?? sql`true`;
  return combine([
    ...roots.map(({ predicate }) => predicate),
    ...[...groups.values()].map(combine),
  ]);
}

export async function getContentDatabaseNavigationPage(args: {
  database: typeof schema.contentDatabases.$inferSelect;
  userEmail: string;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
  limit: number;
  cursor?: string;
}): Promise<ContentDatabaseNavigationPageResponse> {
  if (args.database.systemRole !== "files" || !args.database.spaceId) {
    fail("Navigation mode is only available for a Files database.", {
      errorCode: "unsupported_navigation_database",
      statusCode: 400,
    });
  }

  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  const sharedConfig = parseDatabaseViewConfig(args.database.viewConfigJson);
  const overrides = await readPersonalDatabaseViewOverrides(
    args.userEmail,
    args.database.id,
  );
  const viewId =
    args.viewId ?? overrides?.activeViewId ?? sharedConfig.activeViewId;
  const sharedView =
    sharedConfig.views.find((candidate) => candidate.id === viewId) ??
    (!args.viewId
      ? sharedConfig.views.find(
          (candidate) => candidate.id === sharedConfig.activeViewId,
        )
      : undefined);
  if (!sharedView) {
    fail("The selected Files view no longer exists.", {
      errorCode: "invalid_navigation_view",
      statusCode: 400,
    });
  }
  const personalView = overrides?.views.find(
    (candidate) => candidate.id === viewId,
  );
  const effectiveFilters = personalView?.filters ?? sharedView.filters;
  const effectiveFilterMode =
    personalView?.filterMode ?? sharedView.filterMode ?? "and";
  const sharedSort = (personalView?.sorts ?? sharedView.sorts)[0];
  const configuredSort =
    sharedSort?.key === "name"
      ? "name"
      : sharedSort?.key === "created" || sharedSort?.key === "created_at"
        ? "created"
        : sharedSort?.key === "updated" ||
            sharedSort?.key === "updated_at" ||
            sharedSort?.key === "last_edited"
          ? "last_edited"
          : null;
  const sidebarSort = personalView?.sidebarOrder?.mode;
  const effectiveSort = sidebarSort ?? configuredSort ?? args.sort;
  const descending = sidebarSort
    ? sidebarSort === "created" || sidebarSort === "last_edited"
    : effectiveSort !== "custom" && sharedSort?.direction === "desc";
  const itemIds =
    effectiveSort === "custom"
      ? (personalView?.sidebarOrder?.itemIds ?? [])
      : [];
  const orderHash =
    effectiveSort === "custom" ? orderFingerprint(itemIds) : null;
  const configHash = orderFingerprint([
    JSON.stringify({
      viewId,
      sharedView,
      personalView: personalView ?? null,
      effectiveSort,
      descending,
    }),
  ]);
  const db = getDb();
  const accessContext = {
    userEmail: args.userEmail,
    orgId: args.database.orgId ?? undefined,
  };

  if (args.parentId !== null) {
    const [parent] = await db
      .select({ id: schema.documents.id })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, args.database.id),
          eq(schema.documents.id, args.parentId),
          eq(schema.documents.spaceId, args.database.spaceId),
          isNull(schema.documents.trashedAt),
          accessFilter(schema.documents, schema.documentShares, accessContext),
          ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
        ),
      )
      .limit(1);
    if (!parent) {
      fail("The Files navigation parent is unavailable.", {
        errorCode: "invalid_navigation_parent",
        statusCode: 400,
      });
    }
  }

  const effectiveFilter = await navigationFilterSql({
    databaseId: args.database.id,
    filters: effectiveFilters,
    filterMode: effectiveFilterMode,
    document: {
      id: sql`${schema.documents.id}`,
      title: sql`${schema.documents.title}`,
      parentId: sql`${schema.documents.parentId}`,
      ownerEmail: sql`${schema.documents.ownerEmail}`,
      createdAt: sql`${schema.documents.createdAt}`,
      updatedAt: sql`${schema.documents.updatedAt}`,
    },
  });

  const childDocuments = alias(schema.documents, "navigation_child_documents");
  const childItems = alias(
    schema.contentDatabaseItems,
    "navigation_child_memberships",
  );
  const databaseDocuments = alias(
    schema.contentDatabases,
    "navigation_database_documents",
  );
  const siblingFilter = and(
    eq(schema.contentDatabaseItems.databaseId, args.database.id),
    args.parentId === null
      ? isNull(schema.documents.parentId)
      : eq(schema.documents.parentId, args.parentId),
    isNull(schema.documents.trashedAt),
    accessFilter(schema.documents, schema.documentShares, accessContext),
    ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
    effectiveFilter,
  );
  const accessRevision = sql<string>`coalesce((
    SELECT string_agg(ds.role || ':' || ds.principal_type || ':' || ds.principal_id, ',' ORDER BY ds.role, ds.principal_type, ds.principal_id)
    FROM document_shares ds
    WHERE ds.resource_id = ${schema.documents.id}
      AND ((ds.principal_type = 'user' AND lower(ds.principal_id) = lower(${args.userEmail}))
        ${args.database.orgId ? sql`OR (ds.principal_type = 'org' AND ds.principal_id = ${args.database.orgId})` : sql``})
  ), '')`;
  const [revisionState] = await db
    .select({
      count: sql<number>`count(*)::int`,
      checksum: sql<string>`coalesce(sum(hashtextextended(concat_ws('|',
        ${schema.contentDatabaseItems.id}, ${schema.contentDatabaseItems.position}::text,
        ${schema.contentDatabaseItems.updatedAt}, ${schema.documents.id},
        coalesce(${schema.documents.parentId}, ''), ${schema.documents.title},
        ${schema.documents.createdAt}, ${schema.documents.updatedAt},
        ${schema.documents.visibility}, coalesce(${schema.documents.trashedAt}, ''),
        coalesce(${schema.documents.sourceKind}, ''), ${accessRevision}
      ), 0)::numeric)::text, '0')`,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(siblingFilter);
  const revision = `${revisionState.count}:${revisionState.checksum}`;
  if (
    cursor &&
    (cursor.databaseId !== args.database.id ||
      cursor.parentId !== args.parentId ||
      cursor.sort !== effectiveSort ||
      cursor.viewId !== viewId ||
      cursor.orderHash !== orderHash ||
      cursor.configHash !== configHash ||
      cursor.revision !== revision)
  ) {
    invalidCursor();
  }
  const visibleChild = and(
    eq(childItems.databaseId, args.database.id),
    eq(childDocuments.parentId, schema.documents.id),
    isNull(childDocuments.trashedAt),
    accessFilter(childDocuments, schema.documentShares, accessContext),
    ...softDeletedDatabaseDocumentExclusions(childDocuments.id),
    await navigationFilterSql({
      databaseId: args.database.id,
      filters: effectiveFilters,
      filterMode: effectiveFilterMode,
      document: {
        id: sql`${childDocuments.id}`,
        title: sql`${childDocuments.title}`,
        parentId: sql`${childDocuments.parentId}`,
        ownerEmail: sql`${childDocuments.ownerEmail}`,
        createdAt: sql`${childDocuments.createdAt}`,
        updatedAt: sql`${childDocuments.updatedAt}`,
      },
    }),
  );
  const activeDatabaseDocument = db
    .select({ id: databaseDocuments.id })
    .from(databaseDocuments)
    .where(
      and(
        eq(databaseDocuments.documentId, schema.documents.id),
        isNull(databaseDocuments.deletedAt),
      ),
    );
  const customRank =
    itemIds.length > 0
      ? sql<number>`COALESCE(array_position(ARRAY[${sql.join(
          itemIds.map((itemId) => sql`${itemId}`),
          sql`, `,
        )}]::text[], ${schema.contentDatabaseItems.id}), ${itemIds.length + 1})`
      : sql<number>`CAST(1 AS integer)`;
  const sortValue: SQL<string | number> =
    effectiveSort === "custom"
      ? customRank
      : effectiveSort === "name"
        ? sql<string>`${schema.documents.title}`
        : effectiveSort === "created"
          ? sql<string>`${schema.documents.createdAt}`
          : sql<string>`${schema.documents.updatedAt}`;
  const ascending = effectiveSort === "custom" || !descending;
  const cursorFilter = cursor
    ? effectiveSort === "custom"
      ? or(
          gt(customRank, Number(cursor.sortValue)),
          and(
            eq(customRank, Number(cursor.sortValue)),
            gt(schema.contentDatabaseItems.position, cursor.position!),
          ),
          and(
            eq(customRank, Number(cursor.sortValue)),
            eq(schema.contentDatabaseItems.position, cursor.position!),
            gt(schema.contentDatabaseItems.id, cursor.itemId),
          ),
        )
      : or(
          ascending
            ? gt(sortValue, cursor.sortValue)
            : lt(sortValue, cursor.sortValue),
          and(
            eq(sortValue, cursor.sortValue),
            gt(schema.contentDatabaseItems.id, cursor.itemId),
          ),
        )
    : undefined;

  const rows = await db
    .select({
      membershipId: schema.contentDatabaseItems.id,
      membershipPosition: schema.contentDatabaseItems.position,
      documentId: schema.documents.id,
      parentId: schema.documents.parentId,
      title: schema.documents.title,
      icon: schema.documents.icon,
      spaceId: schema.documents.spaceId,
      sourceKind: schema.documents.sourceKind,
      ownerEmail: schema.documents.ownerEmail,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
      sortValue,
      type: sql<"page" | "database">`CASE WHEN ${exists(
        activeDatabaseDocument,
      )} THEN 'database' ELSE 'page' END`,
      hasChildren: sql<boolean>`${exists(
        db
          .select({ id: childItems.id })
          .from(childItems)
          .innerJoin(
            childDocuments,
            eq(childDocuments.id, childItems.documentId),
          )
          .where(visibleChild),
      )}`,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(and(siblingFilter, cursorFilter))
    .orderBy(
      ascending ? asc(sortValue) : desc(sortValue),
      ...(effectiveSort === "custom"
        ? [asc(schema.contentDatabaseItems.position)]
        : []),
      asc(schema.contentDatabaseItems.id),
    )
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const pageRows = rows.slice(0, args.limit);
  const favoriteIds = await favoriteDocumentIds(
    db,
    args.userEmail,
    pageRows.map((row) => row.documentId),
  );
  const shareRows = pageRows.length
    ? await db
        .select({
          resourceId: schema.documentShares.resourceId,
          role: schema.documentShares.role,
        })
        .from(schema.documentShares)
        .where(
          and(
            inArray(
              schema.documentShares.resourceId,
              pageRows.map((row) => row.documentId),
            ),
            or(
              and(
                eq(schema.documentShares.principalType, "user"),
                eq(schema.documentShares.principalId, args.userEmail),
              ),
              ...(args.database.orgId
                ? [
                    and(
                      eq(schema.documentShares.principalType, "org"),
                      eq(
                        schema.documentShares.principalId,
                        args.database.orgId,
                      ),
                    ),
                  ]
                : []),
            ),
          ),
        )
    : [];
  const editableIds = new Set(
    shareRows
      .filter((row) => ["owner", "admin", "editor"].includes(row.role))
      .map((row) => row.resourceId),
  );
  const manageableIds = new Set(
    shareRows
      .filter((row) => ["owner", "admin"].includes(row.role))
      .map((row) => row.resourceId),
  );
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(({ sortValue: _sortValue, ownerEmail, ...row }) => {
      const isOwner = ownerEmail.toLowerCase() === args.userEmail.toLowerCase();
      return {
        ...row,
        isFavorite: favoriteIds.has(row.documentId),
        canEdit: isOwner || editableIds.has(row.documentId),
        canManage: isOwner || manageableIds.has(row.documentId),
      };
    }),
    pagination: {
      limit: args.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              version: CURSOR_VERSION,
              databaseId: args.database.id,
              parentId: args.parentId,
              sort: effectiveSort,
              viewId,
              orderHash,
              revision,
              configHash,
              sortValue: last.sortValue,
              position:
                effectiveSort === "custom"
                  ? last.membershipPosition
                  : undefined,
              itemId: last.membershipId,
            })
          : null,
    },
  };
}
