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

import type {
  ContentDatabaseItem,
  ContentDatabaseSource,
  ContentDatabaseSourceOverlay,
  ContentDatabaseSourceRow,
  DocumentPropertyValue,
} from "../shared/api.js";
import { evaluateNormalizationFormula } from "../shared/properties.js";
import {
  contentDatabaseSourceFieldAllowsLocalWrite,
  contentDatabaseSourceManagedPropertyIds,
} from "../shared/source-field-policy.js";

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
  const rowByDocumentId = new Map<string, ContentDatabaseSourceRow>();
  for (const source of sources) {
    for (const row of source.rows) {
      if (!row.documentId || rowByDocumentId.has(row.documentId)) continue;
      rowByDocumentId.set(row.documentId, row);
    }
  }

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
        if (key !== null && !byKey.has(key)) byKey.set(key, row);
      }
      return { source, federation, byKey };
    });

  if (!primaryFederation || secondaries.length === 0) {
    return items.map((item) => ({
      ...item,
      sourceRecord:
        primaryRowByDocumentId.get(item.document.id) ??
        rowByDocumentId.get(item.document.id) ??
        item.sourceRecord,
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
      sourceRecord:
        primaryRow ??
        rowByDocumentId.get(item.document.id) ??
        item.sourceRecord,
      canonicalKey,
      sourceOverlays: overlays.length > 0 ? overlays : undefined,
    };
  });
}

export function applyFederatedOverlayValues(
  items: ContentDatabaseItem[],
  sources: ContentDatabaseSource[],
): ContentDatabaseItem[] {
  const sourceManagedPropertyIds = contentDatabaseSourceManagedPropertyIds(
    sources.flatMap((source) => source.fields),
  );
  const secondaryPropertyIds = new Set(
    sources
      .filter((source) => source.metadata.federation?.role === "secondary")
      .flatMap((source) =>
        source.fields.flatMap((field) =>
          field.propertyId && !contentDatabaseSourceFieldAllowsLocalWrite(field)
            ? [field.propertyId]
            : [],
        ),
      ),
  );
  const primaryOrStandalonePropertyIds = new Set(
    sources
      .filter((source) => source.metadata.federation?.role !== "secondary")
      .flatMap((source) =>
        source.fields.flatMap((field) =>
          field.propertyId ? [field.propertyId] : [],
        ),
      ),
  );
  return items.map((item) => {
    const valueByPropertyId = new Map<string, DocumentPropertyValue>();
    for (const overlay of item.sourceOverlays ?? []) {
      for (const field of overlay.fields) {
        if (!field.propertyId) continue;
        valueByPropertyId.set(
          field.propertyId,
          overlay.values[field.sourceFieldKey] ?? null,
        );
      }
    }
    return {
      ...item,
      properties: item.properties.map((property) => {
        const propertyId = property.definition.id;
        if (valueByPropertyId.has(propertyId)) {
          return {
            ...property,
            value: valueByPropertyId.get(propertyId) ?? null,
            editable: false,
          };
        }
        if (!sourceManagedPropertyIds.has(propertyId)) return property;
        return secondaryPropertyIds.has(propertyId) &&
          !primaryOrStandalonePropertyIds.has(propertyId)
          ? { ...property, value: null, editable: false }
          : { ...property, editable: false };
      }),
    };
  });
}
