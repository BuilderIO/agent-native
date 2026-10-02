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
  gte,
  inArray,
  isNull,
  lt,
  lte,
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
  ContentDatabasePersonalViewOverrides,
} from "../shared/api.js";
import { favoritesSystemIds } from "./_content-favorites.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

const CURSOR_VERSION = 2;

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

async function navigationFilterDefinitions(
  databaseId: string,
  filters: ContentDatabaseFilter[],
) {
  const propertyIds = [
    ...new Set(
      filters
        .filter(activeNavigationFilter)
        .map((filter) => filter.key)
        .filter((key) => key !== "name"),
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
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(schema.documentPropertyDefinitions.id, propertyIds),
          ),
        )
    : [];
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

function navigationFilterSql(args: {
  filters: ContentDatabaseFilter[];
  filterMode: ContentDatabaseFilterMode;
  definitionById: Awaited<ReturnType<typeof navigationFilterDefinitions>>;
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
  const definitionById = args.definitionById;

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

type NavigationRevision = { count: number; checksum: bigint };

function combineRevisions(parts: NavigationRevision[]) {
  return `${parts.reduce((total, part) => total + part.count, 0)}:${parts.reduce(
    (total, part) => total + part.checksum,
    0n,
  )}`;
}

// Expanded branches one read returns with its page, and how many expanded
// document IDs it accepts.
export const MAX_NAVIGATION_EXPANDED_BRANCHES = 32;
export const MAX_NAVIGATION_EXPAND_IDS = 100;

type NavigationPage = Omit<ContentDatabaseNavigationPageResponse, "branches">;

export async function getContentDatabaseNavigationPage(args: {
  database: typeof schema.contentDatabases.$inferSelect;
  userEmail: string;
  overrides: ContentDatabasePersonalViewOverrides | null;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
  limit: number;
  cursor?: string;
  expand?: readonly string[];
}): Promise<ContentDatabaseNavigationPageResponse> {
  if (args.database.systemRole !== "files" || !args.database.spaceId) {
    fail("Navigation mode is only available for a Files database.", {
      errorCode: "unsupported_navigation_database",
      statusCode: 400,
    });
  }

  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  const db = getDb();
  const accessContext = {
    userEmail: args.userEmail,
    orgId: args.database.orgId ?? undefined,
  };
  const overrides = args.overrides;
  const sharedConfig = parseDatabaseViewConfig(args.database.viewConfigJson);
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
  if (
    cursor &&
    (cursor.databaseId !== args.database.id ||
      cursor.parentId !== args.parentId ||
      cursor.sort !== effectiveSort ||
      cursor.viewId !== viewId ||
      cursor.orderHash !== orderHash ||
      cursor.configHash !== configHash)
  ) {
    invalidCursor();
  }

  const definitionById = await navigationFilterDefinitions(
    args.database.id,
    effectiveFilters,
  );
  const effectiveFilter = navigationFilterSql({
    filters: effectiveFilters,
    filterMode: effectiveFilterMode,
    definitionById,
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
  const favoriteItems = alias(
    schema.contentDatabaseItems,
    "navigation_favorite_memberships",
  );
  const roleShares = alias(schema.documentShares, "navigation_role_shares");
  const databaseDocuments = alias(
    schema.contentDatabases,
    "navigation_database_documents",
  );
  const siblingsOf = (parentId: string | null) =>
    and(
      eq(schema.contentDatabaseItems.databaseId, args.database.id),
      parentId === null
        ? isNull(schema.documents.parentId)
        : eq(schema.documents.parentId, parentId),
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
  const rowHash = sql`hashtextextended(concat_ws('|',
    ${schema.contentDatabaseItems.id}, ${schema.contentDatabaseItems.position}::text,
    ${schema.contentDatabaseItems.updatedAt}, ${schema.documents.id},
    coalesce(${schema.documents.parentId}, ''), ${schema.documents.title},
    ${schema.documents.createdAt}, ${schema.documents.updatedAt},
    ${schema.documents.visibility}, coalesce(${schema.documents.trashedAt}, ''),
    coalesce(${schema.documents.sourceKind}, ''), ${accessRevision}
  ), 0)`;
  const activeDatabaseDocument = db
    .select({ id: databaseDocuments.id })
    .from(databaseDocuments)
    .where(
      and(
        eq(databaseDocuments.documentId, schema.documents.id),
        isNull(databaseDocuments.deletedAt),
      ),
    );
  const visibleChild = db
    .select({ id: childItems.id })
    .from(childItems)
    .innerJoin(childDocuments, eq(childDocuments.id, childItems.documentId))
    .where(
      and(
        eq(childItems.databaseId, args.database.id),
        eq(childDocuments.parentId, schema.documents.id),
        isNull(childDocuments.trashedAt),
        accessFilter(childDocuments, schema.documentShares, accessContext),
        ...softDeletedDatabaseDocumentExclusions(childDocuments.id),
        navigationFilterSql({
          filters: effectiveFilters,
          filterMode: effectiveFilterMode,
          definitionById,
          document: {
            id: sql`${childDocuments.id}`,
            title: sql`${childDocuments.title}`,
            parentId: sql`${childDocuments.parentId}`,
            ownerEmail: sql`${childDocuments.ownerEmail}`,
            createdAt: sql`${childDocuments.createdAt}`,
            updatedAt: sql`${childDocuments.updatedAt}`,
          },
        }),
      ),
    );
  const favoriteMembership = db
    .select({ id: favoriteItems.id })
    .from(favoriteItems)
    .where(
      and(
        eq(
          favoriteItems.databaseId,
          favoritesSystemIds(args.userEmail).databaseId,
        ),
        eq(favoriteItems.documentId, schema.documents.id),
      ),
    );
  const sharedWithRole = (roles: Array<"admin" | "editor">) =>
    db
      .select({ id: roleShares.id })
      .from(roleShares)
      .where(
        and(
          eq(roleShares.resourceId, schema.documents.id),
          inArray(roleShares.role, roles),
          or(
            and(
              eq(roleShares.principalType, "user"),
              eq(roleShares.principalId, args.userEmail),
            ),
            args.database.orgId
              ? and(
                  eq(roleShares.principalType, "org"),
                  eq(roleShares.principalId, args.database.orgId),
                )
              : undefined,
          ),
        ),
      );
  // The per-row lookups below are subqueries in the select list, so Postgres
  // runs them only for the rows the page returns, after its sort and limit.
  const rowFields = {
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
    type: sql<"page" | "database">`CASE WHEN ${exists(
      activeDatabaseDocument,
    )} THEN 'database' ELSE 'page' END`,
    hasChildren: sql<boolean>`${exists(visibleChild)}`,
    isFavorite: sql<boolean>`${exists(favoriteMembership)}`,
    sharedEditor: sql<boolean>`${exists(sharedWithRole(["admin", "editor"]))}`,
    sharedManager: sql<boolean>`${exists(sharedWithRole(["admin"]))}`,
    rowHash: sql<string>`${rowHash}::text`,
  };
  const membershipRows = (where: SQL | undefined) =>
    db
      .select(rowFields)
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where);
  type NavigationRow = Awaited<ReturnType<typeof membershipRows>>[number] & {
    sortValue: string | number;
  };

  // A cursor stays valid while every visible sibling up to it is unchanged:
  // rows after it are read fresh by the next page anyway. The revision is the
  // count and hash sum of that prefix, so it grows with the pages read, not
  // with the workspace.
  const revisionOf = async (
    query: Promise<Array<{ count: number; checksum: string }>>,
  ): Promise<NavigationRevision> => {
    const [row] = await query;
    return { count: row?.count ?? 0, checksum: BigInt(row?.checksum ?? "0") };
  };
  const revisionFields = {
    count: sql<number>`count(*)::int`,
    checksum: sql<string>`coalesce(sum((${rowHash})::numeric), 0)::text`,
  };
  const membershipRevision = (where: SQL | undefined) =>
    db
      .select(revisionFields)
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where);

  type NavigationOrder = {
    page: (
      siblings: SQL | undefined,
      after: NavigationCursor | null,
    ) => Promise<NavigationRow[]>;
    through: (
      siblings: SQL | undefined,
      cursor: NavigationCursor,
    ) => Promise<NavigationRevision[]>;
  };

  const sortValue: SQL<string> =
    effectiveSort === "name"
      ? sql<string>`${schema.documents.title}`
      : effectiveSort === "created"
        ? sql<string>`${schema.documents.createdAt}`
        : sql<string>`${schema.documents.updatedAt}`;
  const ascending = !descending;
  const sortedAfter = (key: { sortValue: string | number; itemId: string }) =>
    or(
      ascending ? gt(sortValue, key.sortValue) : lt(sortValue, key.sortValue),
      and(
        eq(sortValue, key.sortValue),
        gt(schema.contentDatabaseItems.id, key.itemId),
      ),
    );
  const sortedOrder: NavigationOrder = {
    page: (siblings, after) =>
      db
        .select({ ...rowFields, sortValue })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, schema.contentDatabaseItems.documentId),
        )
        .where(and(siblings, after ? sortedAfter(after) : undefined))
        .orderBy(
          ascending ? asc(sortValue) : desc(sortValue),
          asc(schema.contentDatabaseItems.id),
        )
        .limit(args.limit + 1),
    through: (siblings, cursor) =>
      Promise.all([
        revisionOf(
          membershipRevision(
            and(
              siblings,
              ascending
                ? lte(sortValue, cursor.sortValue)
                : gte(sortValue, cursor.sortValue),
              sql`not (${sortedAfter(cursor)!})`,
            ),
          ),
        ),
      ]),
  };

  // Custom order puts the saved item IDs first, in saved order, and the rest
  // after them by position.
  const rankById = new Map<string, number>();
  itemIds.forEach((itemId, index) => {
    if (!rankById.has(itemId)) rankById.set(itemId, index + 1);
  });
  const unrankedValue = itemIds.length + 1;
  const allRanks = [...rankById];

  // The root holds most of a workspace, and a saved order mostly lists root
  // items, so the root walks the saved list in order through primary-key
  // lookups and the unranked rest through the (database_id, position, id)
  // index. Neither sorts the whole Files database.
  const savedRanks = (ranks: Array<[string, number]>) =>
    sql`jsonb_to_recordset(${JSON.stringify(
      ranks.map(([itemId, rank]) => ({ item_id: itemId, rank })),
    )}::jsonb) as saved_rank(item_id text, rank integer)`;
  const rankedSource = (ranks: Array<[string, number]>) =>
    sql`(select item_id, rank from ${savedRanks(ranks)} order by rank) as navigation_rank`;
  // NOT IN over a subquery is a hashed lookup; NOT EXISTS here would rescan
  // the saved list for every candidate row.
  const notRanked = allRanks.length
    ? sql`${schema.contentDatabaseItems.id} not in (select item_id from ${savedRanks(allRanks)})`
    : undefined;
  const rankedRows = (ranks: Array<[string, number]>) =>
    db
      .select({ ...rowFields, sortValue: sql<number>`navigation_rank.rank` })
      .from(rankedSource(ranks))
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.id, sql`navigation_rank.item_id`),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      );
  const positionAfter = (key: { position?: number; itemId: string }) =>
    sql`(${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id}) > (${key.position!}, ${key.itemId})`;
  const positionThrough = (key: { position?: number; itemId: string }) =>
    sql`(${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id}) <= (${key.position!}, ${key.itemId})`;
  const savedListOrder: NavigationOrder = {
    page: async (siblings, after) => {
      const cursorRank = after ? Number(after.sortValue) : 0;
      const rankedAfterCursor = allRanks.filter(
        ([, rank]) => rank > cursorRank,
      );
      const rankedPage = (ranks: Array<[string, number]>) =>
        ranks.length
          ? rankedRows(ranks)
              .where(siblings)
              .orderBy(sql`navigation_rank.rank`)
              .limit(args.limit + 1)
          : Promise.resolve([]);
      // A saved order can hold thousands of IDs, but a page usually fills
      // from the first few, so the whole list is only sent when that window
      // falls short. Rows past the last saved sibling come from the unranked
      // side.
      const window = rankedAfterCursor.slice(0, (args.limit + 1) * 4);
      let ranked = await rankedPage(window);
      let unranked: Awaited<ReturnType<typeof membershipRows>> = [];
      if (ranked.length <= args.limit) {
        const [rest, tail] = await Promise.all([
          rankedPage(rankedAfterCursor.slice(window.length)),
          membershipRows(
            and(
              siblings,
              notRanked,
              after && cursorRank === unrankedValue
                ? positionAfter(after)
                : undefined,
            ),
          )
            .orderBy(
              asc(schema.contentDatabaseItems.position),
              asc(schema.contentDatabaseItems.id),
            )
            .limit(args.limit + 1),
        ]);
        ranked = [...ranked, ...rest].slice(0, args.limit + 1);
        unranked = tail.slice(0, args.limit + 1 - ranked.length);
      }
      return [
        ...ranked,
        ...unranked.map((row) => ({ ...row, sortValue: unrankedValue })),
      ];
    },
    through: (siblings, cursor) => {
      const cursorRank = Number(cursor.sortValue);
      const ranksThrough = allRanks.filter(([, rank]) => rank <= cursorRank);
      return Promise.all([
        ...(ranksThrough.length
          ? [
              revisionOf(
                db
                  .select(revisionFields)
                  .from(rankedSource(ranksThrough))
                  .innerJoin(
                    schema.contentDatabaseItems,
                    eq(
                      schema.contentDatabaseItems.id,
                      sql`navigation_rank.item_id`,
                    ),
                  )
                  .innerJoin(
                    schema.documents,
                    eq(
                      schema.documents.id,
                      schema.contentDatabaseItems.documentId,
                    ),
                  )
                  .where(siblings),
              ),
            ]
          : []),
        ...(cursorRank === unrankedValue
          ? [
              revisionOf(
                membershipRevision(
                  and(siblings, notRanked, positionThrough(cursor)),
                ),
              ),
            ]
          : []),
      ]);
    },
  };

  // A folder's own children are found through the parent_id index, so a
  // child branch ranks just those rows by looking each one up in the saved
  // order, instead of walking a saved list that mostly holds other branches.
  // The order is one jsonb object bound once; a joined set of saved IDs would
  // be estimated at 100 rows and planned as a rescan per sibling.
  const savedOrder = sql`(select ${JSON.stringify(
    Object.fromEntries(rankById),
  )}::jsonb as ranks) as navigation_saved_order`;
  const siblingRank = sql<number>`coalesce((navigation_saved_order.ranks ->> ${schema.contentDatabaseItems.id})::int, ${unrankedValue})`;
  const siblingKey = sql`(${siblingRank}, ${schema.contentDatabaseItems.position}, ${schema.contentDatabaseItems.id})`;
  const cursorKey = (key: NavigationCursor) =>
    sql`(${Number(key.sortValue)}, ${key.position!}, ${key.itemId})`;
  const siblingRankOrder: NavigationOrder = {
    page: (siblings, after) =>
      db
        .select({ ...rowFields, sortValue: siblingRank })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, schema.contentDatabaseItems.documentId),
        )
        .innerJoin(savedOrder, sql`true`)
        .where(
          and(
            siblings,
            after ? sql`${siblingKey} > ${cursorKey(after)}` : undefined,
          ),
        )
        .orderBy(
          siblingRank,
          asc(schema.contentDatabaseItems.position),
          asc(schema.contentDatabaseItems.id),
        )
        .limit(args.limit + 1),
    through: (siblings, cursor) =>
      Promise.all([
        revisionOf(
          db
            .select(revisionFields)
            .from(schema.contentDatabaseItems)
            .innerJoin(
              schema.documents,
              eq(schema.documents.id, schema.contentDatabaseItems.documentId),
            )
            .innerJoin(savedOrder, sql`true`)
            .where(and(siblings, sql`${siblingKey} <= ${cursorKey(cursor)}`)),
        ),
      ]),
  };

  const readBranch = async (
    parentId: string | null,
    after: NavigationCursor | null,
  ): Promise<NavigationPage> => {
    const order =
      effectiveSort !== "custom"
        ? sortedOrder
        : parentId === null
          ? savedListOrder
          : siblingRankOrder;
    const siblings = siblingsOf(parentId);
    const [rows, prefixRevision] = await Promise.all([
      order.page(siblings, after),
      after ? order.through(siblings, after) : [],
    ]);
    if (after && combineRevisions(prefixRevision) !== after.revision) {
      invalidCursor();
    }
    const hasMore = rows.length > args.limit;
    const pageRows = rows.slice(0, args.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map(
        ({
          sortValue: _sortValue,
          rowHash: _rowHash,
          ownerEmail,
          sharedEditor,
          sharedManager,
          ...row
        }) => {
          const isOwner =
            ownerEmail.toLowerCase() === args.userEmail.toLowerCase();
          return {
            ...row,
            canEdit: isOwner || sharedEditor,
            canManage: isOwner || sharedManager,
          };
        },
      ),
      pagination: {
        limit: args.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                version: CURSOR_VERSION,
                databaseId: args.database.id,
                parentId,
                sort: effectiveSort,
                viewId,
                orderHash,
                revision: combineRevisions([
                  ...prefixRevision,
                  {
                    count: pageRows.length,
                    checksum: pageRows.reduce(
                      (total, row) => total + BigInt(row.rowHash),
                      0n,
                    ),
                  },
                ]),
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
  };

  // The requested parent and the expanded folders pass the same access,
  // trash, and deletion checks before any of their children are read.
  const checkedIds = [
    ...(args.parentId === null ? [] : [args.parentId]),
    ...new Set(args.expand),
  ];
  const checked =
    checkedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.documents.id,
            parentId: schema.documents.parentId,
          })
          .from(schema.contentDatabaseItems)
          .innerJoin(
            schema.documents,
            eq(schema.documents.id, schema.contentDatabaseItems.documentId),
          )
          .where(
            and(
              eq(schema.contentDatabaseItems.databaseId, args.database.id),
              inArray(schema.documents.id, checkedIds),
              eq(schema.documents.spaceId, args.database.spaceId),
              isNull(schema.documents.trashedAt),
              accessFilter(
                schema.documents,
                schema.documentShares,
                accessContext,
              ),
              ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
            ),
          );
  const pageRead = readBranch(args.parentId, cursor);
  const parentFound = (rows: Array<{ id: string }>) =>
    args.parentId === null || rows.some((row) => row.id === args.parentId);

  // Expanded folders under the requested parent return their first pages
  // with it. Which ones open follows from the checked parent links alone, so
  // every branch reads alongside the page instead of one level per query. A
  // first page also opens expanded folders that are not on it: the sidebar
  // shows the open page's ancestors under their parent's first page wherever
  // they sort.
  const branchReads = checked.then(async (rows) => {
    if (!parentFound(rows)) return [];
    const expand = new Set(args.expand);
    const expandedChildren = new Map<string | null, string[]>();
    for (const row of rows) {
      if (!expand.has(row.id)) continue;
      const siblings = expandedChildren.get(row.parentId) ?? [];
      siblings.push(row.id);
      expandedChildren.set(row.parentId, siblings);
    }
    let level = expandedChildren.get(args.parentId) ?? [];
    if (cursor && level.length > 0) {
      const listed = new Set(
        (await pageRead).items.map((item) => item.documentId),
      );
      level = level.filter((documentId) => listed.has(documentId));
    }
    const opened: string[] = [];
    while (
      level.length > 0 &&
      opened.length < MAX_NAVIGATION_EXPANDED_BRANCHES
    ) {
      const take = level.slice(
        0,
        MAX_NAVIGATION_EXPANDED_BRANCHES - opened.length,
      );
      opened.push(...take);
      level = take.flatMap(
        (documentId) => expandedChildren.get(documentId) ?? [],
      );
    }
    const pages = await Promise.all(
      opened.map((documentId) => readBranch(documentId, null)),
    );
    // A folder with no children the caller can see draws no branch.
    return opened.flatMap((documentId, index) =>
      pages[index]!.items.length > 0
        ? [[documentId, pages[index]!] as const]
        : [],
    );
  });

  const [checkedRows, page, branches] = await Promise.all([
    checked,
    pageRead,
    branchReads,
  ]);
  if (!parentFound(checkedRows)) {
    fail("The Files navigation parent is unavailable.", {
      errorCode: "invalid_navigation_parent",
      statusCode: 400,
    });
  }
  return branches.length > 0
    ? { ...page, branches: Object.fromEntries(branches) }
    : page;
}
