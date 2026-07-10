import { getUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export const PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION = 1;

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

export const personalViewOverridesSchema = z.object({
  version: z.literal(PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION),
  activeViewId: z.string().optional(),
  views: z.array(
    z.object({
      id: z.string(),
      sorts: z.array(sortSchema).default([]),
      filters: z.array(filterSchema).default([]),
      filterMode: z.enum(["and", "or"]).default("and"),
    }),
  ),
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

  await assertAccess("document", database.documentId, "viewer");
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
  return parsed.success ? parsed.data : null;
}
