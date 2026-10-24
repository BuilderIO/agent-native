import { getUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CONTENT_DATABASE_FILTER_OPERATORS,
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
} from "../shared/api.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { filesParentPropertyId } from "./_files-system-properties.js";

export const PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION =
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION;

export const personalDatabaseViewSettingKey = (databaseId: string) =>
  `content-database-personal-view:${databaseId}`;

export const sortSchema = z.object({
  key: z.string(),
  label: z.string(),
  direction: z.enum(["asc", "desc"]),
});

export const filterSchema = z.object({
  key: z.string(),
  label: z.string(),
  operator: z.enum(CONTENT_DATABASE_FILTER_OPERATORS),
  value: z.string(),
  filterGroupId: z.string().optional(),
  parentFilterGroupId: z.string().optional(),
  filterGroupMode: z.enum(["and", "or"]).optional(),
  parentFilterGroupMode: z.enum(["and", "or"]).optional(),
});

const sidebarOrderItemIdSchema = z.string().min(1).max(256);
export const sidebarOrderSchema = z.object({
  mode: z.enum(["custom", "last_edited", "name", "created"]),
  itemIds: z.array(sidebarOrderItemIdSchema).max(5_000),
});

const personalViewOverridesFields = {
  activeViewId: z.string().optional(),
  views: z.array(
    z.object({
      id: z.string(),
      sorts: z.array(sortSchema).default([]),
      filters: z.array(filterSchema).default([]),
      filterMode: z.enum(["and", "or"]).default("and"),
      sidebarOrder: sidebarOrderSchema.optional(),
    }),
  ),
};

export const personalViewOverridesSchema = z.object({
  version: z.literal(PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION),
  ...personalViewOverridesFields,
});

export function normalizePersonalDatabaseViewOverrides(
  overrides: z.infer<typeof personalViewOverridesSchema>,
  validItemIds?: ReadonlySet<string>,
) {
  return {
    ...overrides,
    views: overrides.views.map((view) => ({
      ...view,
      sidebarOrder: {
        mode: view.sidebarOrder?.mode ?? "custom",
        itemIds: [...new Set(view.sidebarOrder?.itemIds ?? [])].filter(
          (itemId) => !validItemIds || validItemIds.has(itemId),
        ),
      },
    })),
  };
}

const legacyPersonalViewOverridesSchema = z.object({
  version: z.literal(1),
  ...personalViewOverridesFields,
});

export async function assertContentDatabaseViewerAccess(databaseId: string) {
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
  if (!database) {
    const error = new Error(`Database "${databaseId}" not found`) as Error & {
      statusCode: number;
    };
    error.statusCode = 404;
    throw error;
  }

  try {
    await assertAccess("document", database.documentId, "viewer");
  } catch (error) {
    if (database.systemRole !== "files" || !database.spaceId) throw error;
    await resolveContentSpaceAccess(database.spaceId);
  }
}

export async function readPersonalDatabaseViewOverrides(
  userEmail: string,
  databaseId: string,
) {
  const stored = await getUserSetting(
    userEmail,
    personalDatabaseViewSettingKey(databaseId),
  );
  if (stored === null) return null;
  const parsed = personalViewOverridesSchema.safeParse(stored);
  if (parsed.success)
    return withoutDeletedPersonalViewProperties(
      databaseId,
      normalizePersonalDatabaseViewOverrides(parsed.data),
    );

  legacyPersonalViewOverridesSchema.parse(stored);
  const [database] = await getDb()
    .select({ systemRole: schema.contentDatabases.systemRole })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const migrated = migratePersonalDatabaseViewOverrides(
    stored,
    databaseId,
    database?.systemRole ?? null,
  );
  return migrated && withoutDeletedPersonalViewProperties(databaseId, migrated);
}

/**
 * A sort or filter on a deleted property still applies, and the filter hides
 * every row. Deleting a property cleans the shared views but can't rewrite
 * every person's saved copy, so each personal view Content returns drops them.
 */
export async function withoutDeletedPersonalViewProperties<
  Overrides extends {
    views: Array<{ sorts: { key: string }[]; filters: { key: string }[] }>;
  },
>(databaseId: string, overrides: Overrides): Promise<Overrides> {
  const propertyIds = new Set(
    overrides.views.flatMap((view) =>
      [...view.sorts, ...view.filters]
        .map((entry) => entry.key)
        .filter((key) => key !== "name"),
    ),
  );
  if (propertyIds.size === 0) return overrides;
  const existing = new Set(
    (
      await getDb()
        .select({ id: schema.documentPropertyDefinitions.id })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(schema.documentPropertyDefinitions.id, [...propertyIds]),
          ),
        )
    ).map((property) => property.id),
  );
  if ([...propertyIds].every((id) => existing.has(id))) return overrides;
  const kept = (entry: { key: string }) =>
    entry.key === "name" || existing.has(entry.key);
  return {
    ...overrides,
    views: overrides.views.map((view) => ({
      ...view,
      sorts: view.sorts.filter(kept),
      filters: view.filters.filter(kept),
    })),
  } as Overrides;
}

export function migratePersonalDatabaseViewOverrides(
  stored: unknown,
  databaseId: string,
  systemRole: string | null,
) {
  if (stored === null) return null;
  const parsed = personalViewOverridesSchema.safeParse(stored);
  if (parsed.success)
    return normalizePersonalDatabaseViewOverrides(parsed.data);
  const legacy = legacyPersonalViewOverridesSchema.parse(stored);
  const legacyParentKey = filesParentPropertyId(databaseId);
  return normalizePersonalDatabaseViewOverrides({
    ...legacy,
    version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
    views: legacy.views.map((view) => ({
      ...view,
      filters:
        systemRole === "files"
          ? view.filters.filter(
              (filter) =>
                !(
                  filter.key === legacyParentKey &&
                  filter.operator === "is_empty" &&
                  filter.value === ""
                ),
            )
          : view.filters,
    })),
  });
}
