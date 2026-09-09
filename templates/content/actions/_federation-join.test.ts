import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseItem,
  ContentDatabaseSource,
  ContentDatabaseSourceFederation,
  ContentDatabaseSourceRole,
  ContentDatabaseSourceRow,
} from "../shared/api";
import { computeNormalizedKey, federateSources } from "./_federation-join";

function item(documentId: string): ContentDatabaseItem {
  return {
    id: `item-${documentId}`,
    databaseId: "db",
    document: { id: documentId } as ContentDatabaseItem["document"],
    position: 0,
    properties: [],
  };
}

function row(
  documentId: string,
  values: Record<string, string>,
): ContentDatabaseSourceRow {
  return {
    id: `row-${documentId}`,
    databaseItemId: `item-${documentId}`,
    documentId,
    sourceRowId: `srow-${documentId}`,
    sourceQualifiedId: `q-${documentId}`,
    sourceDisplayKey: documentId,
    sourceValues: values,
    provenance: "test",
    syncState: "linked",
    freshness: "fresh",
    lastSyncedAt: null,
    lastSourceUpdatedAt: null,
  };
}

function federation(
  role: ContentDatabaseSourceRole,
  keyField: string,
  formula: string,
): ContentDatabaseSourceFederation {
  return {
    role,
    keyField,
    normalizationFormula: formula,
    join: {
      kind: "identity",
      collection: null,
      localExpr: "{canonical}",
      remoteKeyField: keyField,
      normalizationFormula: formula,
    },
  };
}

function source(args: {
  id: string;
  rows: ContentDatabaseSourceRow[];
  federation?: ContentDatabaseSourceFederation;
}): ContentDatabaseSource {
  return {
    id: args.id,
    databaseId: "db",
    sourceType: "builder-cms",
    sourceName: args.id,
    sourceTable: args.id,
    syncState: "linked",
    freshness: "fresh",
    lastRefreshedAt: null,
    lastSourceUpdatedAt: null,
    lastError: null,
    capabilities: {} as ContentDatabaseSource["capabilities"],
    metadata: {
      primaryKey: "id",
      titleField: "title",
      federation: args.federation,
    },
    fields: [],
    rows: args.rows,
    changeSets: [],
  };
}

describe("computeNormalizedKey", () => {
  it("normalizes a host-qualified URL to a bare slug", () => {
    expect(
      computeNormalizedKey({
        normalizationFormula: 'replace(striphost({url}), "/blog/", "")',
        sourceValues: { url: "https://site.com/blog/foo" },
      }),
    ).toBe("foo");
  });

  it("returns null for a missing or empty key", () => {
    expect(
      computeNormalizedKey({
        normalizationFormula: "{url}",
        sourceValues: undefined,
      }),
    ).toBeNull();
    expect(
      computeNormalizedKey({
        normalizationFormula: "trim({url})",
        sourceValues: { url: "   " },
      }),
    ).toBeNull();
  });
});

describe("federateSources", () => {
  const primaryFormula = 'replace({data.url}, "/blog/", "")';
  const secondaryFormula = 'replace(striphost({url}), "/blog/", "")';

  it("overlays matching secondary rows and drops orphan keys", () => {
    const items = [item("doc-foo"), item("doc-bar")];
    const primary = source({
      id: "builder",
      federation: federation("primary", "data.url", primaryFormula),
      rows: [
        row("doc-foo", { "data.url": "/blog/foo" }),
        row("doc-bar", { "data.url": "/blog/bar" }),
      ],
    });
    const secondary = source({
      id: "notion",
      federation: federation("secondary", "url", secondaryFormula),
      rows: [
        row("", { url: "https://site.com/blog/foo" }),
        // qux has no primary row → must be dropped (no virtual rows this phase).
        row("", { url: "https://site.com/blog/qux" }),
      ],
    });

    const result = federateSources({ items, sources: [primary, secondary] });

    expect(result).toHaveLength(2);
    const foo = result.find((r) => r.document.id === "doc-foo")!;
    const bar = result.find((r) => r.document.id === "doc-bar")!;
    expect(foo.canonicalKey).toBe("foo");
    expect(foo.sourceOverlays).toHaveLength(1);
    expect(foo.sourceOverlays?.[0]).toMatchObject({
      sourceId: "notion",
      values: { url: "https://site.com/blog/foo" },
    });
    // bar has a canonical key but no secondary match → no overlay.
    expect(bar.canonicalKey).toBe("bar");
    expect(bar.sourceOverlays).toBeUndefined();
    // No virtual row was synthesized for the orphan "qux".
    expect(result.some((r) => r.document.id.includes("qux"))).toBe(false);
  });

  it("leaves items unchanged when only one source and no federation", () => {
    const items = [item("doc-foo")];
    const primary = source({
      id: "builder",
      rows: [row("doc-foo", { "data.url": "/blog/foo" })],
    });
    const result = federateSources({ items, sources: [primary] });
    expect(result[0].canonicalKey).toBeUndefined();
    expect(result[0].sourceOverlays).toBeUndefined();
    // The primary row record is still attached (old single-source behavior).
    expect(result[0].sourceRecord?.documentId).toBe("doc-foo");
  });

  it("does not overlay when the canonical key is un-joinable", () => {
    const items = [item("doc-empty")];
    const primary = source({
      id: "builder",
      federation: federation("primary", "data.url", "trim({data.url})"),
      rows: [row("doc-empty", { "data.url": "   " })],
    });
    const secondary = source({
      id: "notion",
      federation: federation("secondary", "url", "trim({url})"),
      rows: [row("", { url: "   " })],
    });
    const result = federateSources({ items, sources: [primary, secondary] });
    expect(result[0].canonicalKey).toBeNull();
    expect(result[0].sourceOverlays).toBeUndefined();
  });
});
