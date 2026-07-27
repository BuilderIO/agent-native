import { getUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION } from "../shared/api.js";
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

const personalViewOverridesFields = {
  activeViewId: z.string().optional(),
  views: z.array(
    z.object({
      id: z.string(),
      sorts: z.array(sortSchema).default([]),
      filters: z.array(filterSchema).default([]),
      filterMode: z.enum(["and", "or"]).default("and"),
    }),
  ),
};

export const personalViewOverridesSchema = z.object({
  version: z.literal(PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION),
  ...personalViewOverridesFields,
});

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
  if (!database) throw new Error(`Database "${databaseId}" not found`);

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
  const parsed = personalViewOverridesSchema.safeParse(stored);
  if (parsed.success) return parsed.data;

  const legacy = legacyPersonalViewOverridesSchema.safeParse(stored);
  if (!legacy.success) return null;
  const [database] = await getDb()
    .select({ systemRole: schema.contentDatabases.systemRole })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const legacyParentKey = filesParentPropertyId(databaseId);
  return {
    ...legacy.data,
    version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
    views: legacy.data.views.map((view) => ({
      ...view,
      filters:
        database?.systemRole === "files"
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
  };
}
