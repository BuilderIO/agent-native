/**
 * Read another workspace content database as a federation source. Its rows
 * become source entries whose `sourceValues` are keyed by property name (so a
 * normalization formula reads `{Url}`, `{Slug}`, …), and its property
 * definitions become the source's field summaries. This is the real-data
 * counterpart to the Builder read client for the "local tables as a source"
 * feature.
 */

import type {
  BuilderCmsModelFieldSummary,
  DocumentPropertyValue,
} from "../shared/api.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export async function readLocalTableEntries(targetDatabaseId: string): Promise<{
  entries: BuilderCmsSourceEntry[];
  modelFields: BuilderCmsModelFieldSummary[];
}> {
  const response = await getContentDatabaseResponse(targetDatabaseId, {});

  const entries: BuilderCmsSourceEntry[] = response.items.map((item, index) => {
    const sourceValues: Record<string, DocumentPropertyValue> = {
      title: item.document.title ?? "",
    };
    for (const property of item.properties) {
      const key = property.definition.name;
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
    const name = property.definition.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    modelFields.push({
      name,
      type: property.definition.type,
      required: false,
    });
  }

  return { entries, modelFields };
}
