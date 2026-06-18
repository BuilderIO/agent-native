/**
 * Read another workspace content database as a federation source. Its rows
 * become source entries whose `sourceValues` are keyed by stable property id,
 * and its property definitions become the source's field summaries. This is the real-data
 * counterpart to the Builder read client for the "local tables as a source"
 * feature.
 */

import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type {
  BuilderCmsModelFieldSummary,
  DocumentPropertyValue,
} from "../shared/api.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const LOCAL_TABLE_SOURCE_READ_LIMIT = 500;

export async function resolveReadableLocalTableSource(
  targetDatabaseId: string,
) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, targetDatabaseId));
  if (!database)
    throw new Error(`Source database "${targetDatabaseId}" not found.`);
  await assertAccess("document", database.documentId, "viewer");
  return database;
}

export async function readLocalTableEntries(
  targetDatabaseId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{
  entries: BuilderCmsSourceEntry[];
  modelFields: BuilderCmsModelFieldSummary[];
}> {
  await resolveReadableLocalTableSource(targetDatabaseId);
  const response = await getContentDatabaseResponse(targetDatabaseId, {
    limit: options.limit ?? LOCAL_TABLE_SOURCE_READ_LIMIT,
    offset: options.offset ?? 0,
  });

  const entries: BuilderCmsSourceEntry[] = response.items.map((item, index) => {
    const sourceValues: Record<string, DocumentPropertyValue> = {
      title: item.document.title ?? "",
    };
    for (const property of item.properties) {
      const key = property.definition.id;
      if (!key) continue;
      sourceValues[key] = property.value;
    }
    return {
      id: item.document.id || `local-${index + 1}`,
      model: targetDatabaseId,
      title: item.document.title ?? `Row ${index + 1}`,
      urlPath: "",
      updatedAt: item.document.updatedAt ?? "",
      sourceValues,
    };
  });

  const seen = new Set<string>(["title"]);
  const modelFields: BuilderCmsModelFieldSummary[] = [
    { name: "title", type: "text", required: false },
  ];
  for (const property of response.properties) {
    const name = property.definition.id;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    modelFields.push({
      name,
      label: property.definition.name,
      type: property.definition.type,
      required: false,
    });
  }

  return { entries, modelFields };
}
