/**
 * Read-side federation: overlay a secondary source's read-only columns onto the
 * rows it matches, joined on a canonical key.
 *
 * NEXT scope (identity, overlay): each source declares a normalization formula
 * that maps its own key field into a shared key space; rows match on exact
 * string equality after normalization (no fuzzy matching). A secondary row that
 * matches a primary row contributes its values as a `sourceOverlay`. A secondary
 * key with no primary match is **dropped this phase** — rendering those as
 * read-only "virtual rows" (the true union) is the immediately-following
 * sub-step, because it reaches into the editor read path.
 */

import { evaluateNormalizationFormula } from "../shared/properties.js";
import type {
  ContentDatabaseItem,
  ContentDatabaseSource,
  ContentDatabaseSourceOverlay,
  ContentDatabaseSourceRow,
  DocumentPropertyValue,
} from "../shared/api.js";

// Map a source row's own values into the canonical key space. Returns null for
// an un-joinable row (empty/broken formula result) — null never matches, not
// even another null, so un-joinable rows simply stay un-overlaid.
export function computeNormalizedKey(args: {
  normalizationFormula: string;
  sourceValues: Record<string, DocumentPropertyValue> | undefined;
}): string | null {
  if (!args.sourceValues) return null;
  return evaluateNormalizationFormula(
    args.normalizationFormula,
    args.sourceValues,
  );
}

/**
 * Attach the primary source's row record to each item (preserving today's
 * single-source behavior), and, when federation is configured, overlay matching
 * secondary rows onto each item by canonical key.
 */
export function federateSources(args: {
  items: ContentDatabaseItem[];
  sources: ContentDatabaseSource[];
}): ContentDatabaseItem[] {
  const { items, sources } = args;
  const primary =
    sources.find((source) => source.metadata.federation?.role === "primary") ??
    sources[0] ??
    null;
  const primaryFederation = primary?.metadata.federation;

  const primaryRowByDocumentId = new Map(
    (primary?.rows ?? []).map((row) => [row.documentId, row]),
  );

  // Secondary sources carrying an identity-join config.
  const secondaries = sources
    .filter(
      (source) =>
        source !== primary &&
        source.metadata.federation?.role === "secondary" &&
        source.metadata.federation.join.kind === "identity",
    )
    .map((source) => {
      const federation = source.metadata.federation!;
      const byKey = new Map<string, ContentDatabaseSourceRow>();
      for (const row of source.rows) {
        const key = computeNormalizedKey({
          normalizationFormula: federation.join.normalizationFormula,
          sourceValues: row.sourceValues,
        });
        // First row wins on a duplicate normalized key; resolving the ambiguity
        // (manual row-pin) is deferred to a later version.
        if (key !== null && !byKey.has(key)) byKey.set(key, row);
      }
      return { source, federation, byKey };
    });

  // Nothing to federate → behave exactly like the old single-source overlay.
  if (!primaryFederation || secondaries.length === 0) {
    return items.map((item) => ({
      ...item,
      sourceRecord:
        primaryRowByDocumentId.get(item.document.id) ?? item.sourceRecord,
    }));
  }

  return items.map((item) => {
    const primaryRow = primaryRowByDocumentId.get(item.document.id);
    const canonicalKey = primaryRow
      ? computeNormalizedKey({
          normalizationFormula: primaryFederation.join.normalizationFormula,
          sourceValues: primaryRow.sourceValues,
        })
      : null;

    const overlays: ContentDatabaseSourceOverlay[] = [];
    if (canonicalKey !== null) {
      for (const { source, byKey } of secondaries) {
        const match = byKey.get(canonicalKey);
        if (!match) continue;
        overlays.push({
          sourceId: source.id,
          sourceName: source.sourceName,
          sourceRowId: match.sourceRowId,
          values: match.sourceValues ?? {},
          fields: source.fields,
        });
      }
    }

    return {
      ...item,
      sourceRecord: primaryRow ?? item.sourceRecord,
      canonicalKey,
      sourceOverlays: overlays.length > 0 ? overlays : undefined,
    };
  });
}

/**
 * Populate the values of opt-in federated columns from each item's overlays.
 *
 * A secondary field the user added as a column carries a `propertyId` (set by
 * `add-content-database-source-field-property`). Its value isn't stored on the
 * local document — it lives in the matched overlay — so we overwrite that
 * property's value (read-only) per row here. Rows with no matching overlay keep
 * the empty value, which is the correct outer-join behavior.
 */
export function applyFederatedOverlayValues(
  items: ContentDatabaseItem[],
): ContentDatabaseItem[] {
  return items.map((item) => {
    if (!item.sourceOverlays?.length) return item;
    const valueByPropertyId = new Map<string, DocumentPropertyValue>();
    for (const overlay of item.sourceOverlays) {
      for (const field of overlay.fields) {
        if (!field.propertyId) continue;
        valueByPropertyId.set(
          field.propertyId,
          overlay.values[field.sourceFieldKey] ?? null,
        );
      }
    }
    if (valueByPropertyId.size === 0) return item;
    return {
      ...item,
      properties: item.properties.map((property) =>
        valueByPropertyId.has(property.definition.id)
          ? {
              ...property,
              value: valueByPropertyId.get(property.definition.id) ?? null,
              editable: false,
            }
          : property,
      ),
    };
  });
}
