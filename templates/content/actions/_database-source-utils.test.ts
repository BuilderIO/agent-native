import { describe, expect, it } from "vitest";

import type { ContentDatabaseItem, DocumentProperty } from "../shared/api";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
} from "./_builder-cms-source-adapter";
import {
  buildBuilderLocalOutboundChangeSets,
  builderBodyChangeForLocalContent,
  builderBodyHydrationPriorityForRequest,
  builderBodyHydrationAttemptIsTerminal,
  builderBodyNeedsSourceComponentWrite,
  builderBodyHydrationVersion,
  bulkChunkSizeForColumnCount,
  builderCmsEntryAlreadyRepresented,
  buildMockBodyChange,
  buildMockFieldChange,
  withBuilderBodySourceValues,
  mapBuilderCmsEntriesToLocalItems,
  mockProposedValue,
  normalizeSourceFederation,
  normalizeSourceFreshness,
  serializeBuilderCmsSourceReadMetadataRecord,
  serializeSourceMetadataRecord,
  sourceValuesForSnapshot,
  sourceValuesForSeededSourceRow,
  sourceChangeSetKey,
  sourceChangeSetSummary,
  sortBuilderBodyHydrationQueueForProcessing,
} from "./_database-source-utils";
import { serializeBodyHydration } from "./_database-utils";

function property(
  type: DocumentProperty["definition"]["type"],
  value: DocumentProperty["value"],
): DocumentProperty {
  return {
    definition: {
      id: "prop-1",
      databaseId: "db-1",
      name: "Headline",
      type,
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

function item(id: string, title: string): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database-1",
    position: 0,
    document: {
      id,
      parentId: "database-page",
      title,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    properties: [],
  };
}

describe("database source helpers", () => {
  it("sizes bulk chunks from the D1 parameter budget and column count", () => {
    expect(bulkChunkSizeForColumnCount(15, "d1")).toBe(6);
    expect(bulkChunkSizeForColumnCount(13, "d1")).toBe(6);
    expect(bulkChunkSizeForColumnCount(2, "d1")).toBe(45);
    expect(bulkChunkSizeForColumnCount(1, "d1")).toBe(90);
    expect(bulkChunkSizeForColumnCount(15, "postgres")).toBe(60);
  });

  it("serializes queued Builder body hydration with an unset item status as pending", () => {
    expect(
      serializeBodyHydration(
        {
          bodyHydrationStatus: null,
          bodyHydrationAttemptedAt: null,
          bodyHydrationError: null,
          bodyHydrationVersion: null,
        } as any,
        { queued: true },
      ).status,
    ).toBe("pending");
  });

  it("normalizes freshness safely", () => {
    expect(normalizeSourceFreshness("fresh")).toBe("fresh");
    expect(normalizeSourceFreshness("stale")).toBe("stale");
    expect(normalizeSourceFreshness("mysterious fog")).toBe("unknown");
  });

  it("omits heavy Builder body payloads from read snapshots", () => {
    const values = {
      "data.title": "Readable title",
      "data.tags": ["AI", "CMS"],
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "hash-1",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated body",
      [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "<BuilderText />",
      [BUILDER_CMS_BODY_READABLE_MAP_KEY]: '{"blocks":[]}',
      [BUILDER_CMS_BODY_SIDECARS_KEY]: '{"huge":"sidecar"}',
    };

    expect(sourceValuesForSnapshot(values)).toEqual({
      "data.title": "Readable title",
      "data.tags": ["AI", "CMS"],
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "hash-1",
    });
    expect(
      sourceValuesForSnapshot(values, { includeHeavyBuilderBodyValues: true }),
    ).toBe(values);
  });

  it("drops stored federation metadata with unsafe regex formulas", () => {
    expect(
      normalizeSourceFederation({
        role: "primary",
        keyField: "url",
        normalizationFormula: 'regexextract({url}, "(a+)+$", 1)',
        join: {
          kind: "identity",
          collection: null,
          localExpr: "{canonical}",
          remoteKeyField: "url",
          normalizationFormula: 'regexextract({url}, "(a+)+$", 1)',
        },
      }),
    ).toBeUndefined();
  });

  it("serializes Builder read progress metadata for partial refreshes", () => {
    expect(
      JSON.parse(
        serializeBuilderCmsSourceReadMetadataRecord({
          sourceTable: "blog-article",
          readState: "live",
          entryCount: 100,
          matchedRowCount: 98,
          progress: {
            requestedLimit: 500,
            pageSize: 100,
            startOffset: 0,
            nextOffset: 100,
            fetchedEntryCount: 100,
            hasMore: true,
            partial: true,
            readMode: "builder-api",
          },
          sourceFetchState: "fetching",
        }),
      ),
    ).toMatchObject({
      readMode: "builder-api",
      liveReadConfigured: true,
      lastReadEntryCount: 100,
      lastReadMatchedRowCount: 98,
      lastReadLimit: 500,
      lastReadFetchedEntryCount: 100,
      lastReadPartial: true,
      lastReadHasMore: true,
      lastReadNextOffset: 100,
      sourceFetchState: "fetching",
    });
  });

  it("preserves existing Builder model fields during metadata rewrites", () => {
    const existingMetadataJson = JSON.stringify({
      builderModelFields: [
        {
          name: "topics",
          label: "Topics",
          type: "list",
          inputType: "tags",
          required: false,
          options: ["Headless CMS"],
        },
      ],
    });

    expect(
      JSON.parse(
        serializeSourceMetadataRecord({
          sourceType: "builder-cms",
          sourceTable: "blog-article",
          existingMetadataJson,
        }),
      ).builderModelFields,
    ).toEqual([
      {
        name: "topics",
        label: "Topics",
        type: "list",
        inputType: "tags",
        required: false,
        options: ["Headless CMS"],
      },
    ]);
    expect(
      JSON.parse(
        serializeBuilderCmsSourceReadMetadataRecord({
          sourceTable: "blog-article",
          readState: "live",
          entryCount: 1,
          matchedRowCount: 1,
          existingMetadataJson,
        }),
      ).builderModelFields?.[0]?.name,
    ).toBe("topics");
  });

  it("creates a mock field change for text properties", () => {
    const headline = property("text", "Launch week");
    expect(
      buildMockFieldChange({
        property: headline,
        currentValue: headline.value,
      }),
    ).toMatchObject({
      propertyId: "prop-1",
      sourceFieldKey: "fields.headline",
      currentValue: "Launch week",
      proposedValue: "Launch week (mock source update)",
    });
  });

  it("uses typed mock proposed values for numeric and checkbox properties", () => {
    expect(mockProposedValue(property("number", 4), 4)).toBe(5);
    expect(mockProposedValue(property("checkbox", true), true)).toBe(false);
  });

  it("creates a body diff summary without requiring a remote system", () => {
    expect(buildMockBodyChange("First paragraph.")).toEqual({
      summary: "Mock body diff for review-only Phase 1 verification.",
      currentExcerpt: "First paragraph.",
      proposedExcerpt: "First paragraph.\n\n[Mock source proposed paragraph]",
    });
  });

  it("includes the readable body codec in Builder body hydration versions", () => {
    expect(
      builderBodyHydrationVersion({
        id: "entry-1",
        title: "Entry",
        updatedAt: "2026-06-30T00:00:00.000Z",
        sourceValues: {
          "__builder.body.blocksHash": "blocks-hash-1",
        },
      }),
    ).toBe("blocks-hash-1:readable-native-images-v5");
  });

  it("caps Builder body hydration retries on the fifth failed attempt", () => {
    expect(builderBodyHydrationAttemptIsTerminal(4)).toBe(false);
    expect(builderBodyHydrationAttemptIsTerminal(5)).toBe(true);
  });

  it("prioritizes opened Builder body hydration ahead of background work", () => {
    expect(
      builderBodyHydrationPriorityForRequest({ documentId: "doc-open" }),
    ).toBeLessThan(builderBodyHydrationPriorityForRequest({}));

    const ordered = sortBuilderBodyHydrationQueueForProcessing([
      {
        id: "background-old",
        priority: builderBodyHydrationPriorityForRequest({}),
        createdAt: "2026-07-02T10:00:00.000Z",
      },
      {
        id: "opened",
        priority: builderBodyHydrationPriorityForRequest({
          documentId: "doc-open",
        }),
        createdAt: "2026-07-02T10:05:00.000Z",
      },
      {
        id: "background-new",
        priority: builderBodyHydrationPriorityForRequest({}),
        createdAt: "2026-07-02T10:10:00.000Z",
      },
    ]);

    expect(ordered.map((row) => row.id)).toEqual([
      "opened",
      "background-old",
      "background-new",
    ]);
  });

  it("detects stale Builder source markers when prose is unchanged", () => {
    expect(
      builderBodyNeedsSourceComponentWrite({
        currentContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" />\n\nClosing paragraph.',
        nextContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
      }),
    ).toBe(true);
    expect(
      builderBodyNeedsSourceComponentWrite({
        currentContent:
          'Opening paragraph.\n\n<SourceComponent id="source-component-builder-image" provider="builder" componentName="Image" rawRef="content/builder/.raw/image.json" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        nextContent:
          "Opening paragraph.\n\n![Diagram](https://cdn.builder.io/image.png)\n\nClosing paragraph.",
      }),
    ).toBe(true);
    expect(
      builderBodyNeedsSourceComponentWrite({
        currentContent:
          'Opening paragraph with a local edit.\n\n<SourceComponent componentName="Image" />\n\nClosing paragraph.',
        nextContent:
          "Opening paragraph.\n\n![Diagram](https://cdn.builder.io/image.png)\n\nClosing paragraph.",
      }),
    ).toBe(false);
  });

  it("keys open mock proposals by row, field set, kind, and body presence", () => {
    const headline = property("text", "Launch week");
    const fieldChange = buildMockFieldChange({
      property: headline,
      currentValue: headline.value,
    });

    expect(
      sourceChangeSetKey({
        documentId: "row-1",
        databaseItemId: "item-1",
        kind: "field_update",
        fieldChanges: [fieldChange],
        bodyChange: null,
      }),
    ).toBe("row-1|incoming|field_update|no-push-mode|prop-1|no-body");
    expect(
      sourceChangeSetKey({
        documentId: "row-1",
        databaseItemId: "item-1",
        kind: "field_update",
        direction: "outbound",
        pushMode: "autosave",
        fieldChanges: [fieldChange],
        bodyChange: buildMockBodyChange("First paragraph."),
      }),
    ).toBe("row-1|outbound|field_update|autosave|prop-1|body");
  });

  it("separates incoming and outbound Builder changes in de-dupe keys", () => {
    const headline = property("text", "Launch week");
    const fieldChange = buildMockFieldChange({
      property: headline,
      currentValue: headline.value,
    });

    expect(
      sourceChangeSetKey({
        documentId: "row-1",
        databaseItemId: "item-1",
        kind: "field_update",
        direction: "incoming",
        pushMode: null,
        fieldChanges: [fieldChange],
        bodyChange: null,
      }),
    ).not.toBe(
      sourceChangeSetKey({
        documentId: "row-1",
        databaseItemId: "item-1",
        kind: "field_update",
        direction: "outbound",
        pushMode: "autosave",
        fieldChanges: [fieldChange],
        bodyChange: null,
      }),
    );
  });

  it("detects local Builder title edits as outbound pending changes", () => {
    const [changeSet] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Old title",
        },
      ],
      documentTitleById: new Map([["doc-1", "New title"]]),
      storedChangeSets: [],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(changeSet).toMatchObject({
      direction: "outbound",
      state: "pending_push",
      pushMode: "autosave",
      localOnly: true,
      summary: 'Pending local Builder CMS title change for "New title".',
      fieldChanges: [
        {
          localFieldKey: "title",
          sourceFieldKey: "data.title",
          currentValue: "Old title",
          proposedValue: "New title",
        },
      ],
    });
  });

  it("detects local Builder body edits as outbound pending changes", () => {
    const [changeSet] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      bodyChangeByDocumentId: new Map([
        [
          "doc-1",
          {
            summary: "Builder body blocks changed.",
            currentExcerpt: "Old body",
            proposedExcerpt: "New body",
            currentHash: "old-hash",
            proposedHash: "new-hash",
            proposedContent: "New body",
            proposedBlocksJson: "[]",
            sidecarsJson: "{}",
            warnings: [],
          },
        ],
      ]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(changeSet).toMatchObject({
      kind: "body_update",
      direction: "outbound",
      state: "pending_push",
      summary: 'Pending local Builder CMS body change for "Same title".',
      fieldChanges: [],
      bodyChange: {
        proposedHash: "new-hash",
        proposedContent: "New body",
      },
      riskReasons: ["body diff"],
    });
  });

  it("does not report hydrated Builder bodies as edits when the local content still matches the baseline", async () => {
    const change = await builderBodyChangeForLocalContent({
      row: {
        sourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "builder-hash",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable Builder body\n",
        }),
      },
      localContent: "Readable Builder body",
    });

    expect(change).toBeNull();
  });

  it("uses the same MDX escape normalization for hydrated Builder body baselines and diffs", async () => {
    const entry = await withBuilderBodySourceValues({
      id: "entry-mdx-escape",
      model: "blog-article",
      title: "MDX escape",
      urlPath: "/blog/mdx-escape",
      updatedAt: "2026-07-02T00:00:00.000Z",
      sourceValues: {
        "data.title": "MDX escape",
        "data.url": "/blog/mdx-escape",
      },
      rawEntry: {
        id: "entry-mdx-escape",
        model: "blog-article",
        name: "MDX escape",
        lastUpdated: "2026-07-02T00:00:00.000Z",
        data: {
          title: "MDX escape",
          url: "/blog/mdx-escape",
          blocks: [
            {
              "@type": "@builder.io/sdk:Element",
              "@version": 2,
              id: "text-1",
              component: {
                name: "Text",
                options: {
                  text: "<p>Use values &lt;5 with {curly} braces.</p>",
                },
              },
            },
          ],
        },
      },
    });
    const content = String(entry.sourceValues[BUILDER_CMS_BODY_CONTENT_KEY]);
    const losslessContent = String(
      entry.sourceValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY],
    );

    expect(content).toContain("<5");
    expect(content).toContain("{curly}");
    expect(losslessContent).toContain("\\<5");
    expect(losslessContent).toContain("\\{curly\\}");
    expect(entry.sourceValues[BUILDER_CMS_BODY_SIDECARS_KEY]).toBeTruthy();

    const change = await builderBodyChangeForLocalContent({
      row: { sourceValuesJson: JSON.stringify(entry.sourceValues) },
      localContent: content,
    });

    expect(change).toBeNull();
  });

  it("reports a real user body edit after Builder body hydration", async () => {
    const change = await builderBodyChangeForLocalContent({
      row: {
        sourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "builder-hash",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable Builder body",
        }),
      },
      localContent: "Readable Builder body with a local edit",
    });

    expect(change).toMatchObject({
      summary: "Builder body blocks changed.",
      proposedContent: "Readable Builder body with a local edit",
    });
  });

  it("does not report a local Builder body edit without a full body baseline", async () => {
    const change = await builderBodyChangeForLocalContent({
      row: {
        sourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "builder-hash",
        }),
      },
      localContent: "Hydrated local body that came from Builder.",
    });

    expect(change).toBeNull();
  });

  it("detects a changed mapped property field on an existing row (not just title)", () => {
    const [changeSet] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
          sourceValuesJson: JSON.stringify({ "data.body": "old body" }),
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        ["doc-1", new Map([["prop-body", "new body"]])],
      ]),
      writableFields: [
        {
          propertyId: "prop-body",
          localFieldKey: "prop-body",
          sourceFieldKey: "data.body",
          sourceFieldLabel: "Body",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(changeSet).toMatchObject({
      direction: "outbound",
      fieldChanges: [
        {
          localFieldKey: "prop-body",
          sourceFieldKey: "data.body",
          currentValue: "old body",
          proposedValue: "new body",
        },
      ],
    });
  });

  it("does NOT diff a mapped field whose local value matches the source baseline", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
          sourceValuesJson: JSON.stringify({ "data.body": "same body" }),
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        ["doc-1", new Map([["prop-body", "same body"]])],
      ]),
      writableFields: [
        {
          propertyId: "prop-body",
          localFieldKey: "prop-body",
          sourceFieldKey: "data.body",
          sourceFieldLabel: "Body",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);
    expect(pending).toHaveLength(0);
  });

  it("creates a create_draft change-set for a new local row not linked to Builder", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-linked",
          documentId: "doc-linked",
          sourceDisplayKey: "Linked entry",
        },
      ],
      documentTitleById: new Map([
        ["doc-linked", "Linked entry"],
        ["doc-new", "Brand New Article"],
      ]),
      storedChangeSets: [],
      databaseItems: [
        { databaseItemId: "item-linked", documentId: "doc-linked" },
        { databaseItemId: "item-new", documentId: "doc-new" },
      ],
      localValuesByDocument: new Map([
        ["doc-new", new Map([["prop-body", "Hello body"]])],
      ]),
      writableFields: [
        {
          propertyId: "prop-body",
          localFieldKey: "prop-body",
          sourceFieldKey: "data.body",
          sourceFieldLabel: "Body",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    const create = pending.find((cs) => cs.documentId === "doc-new");
    expect(create).toMatchObject({
      direction: "outbound",
      state: "pending_push",
      databaseItemId: "item-new",
      summary: 'Pending new Builder entry "Brand New Article".',
      fieldChanges: [
        {
          localFieldKey: "title",
          sourceFieldKey: "data.title",
          currentValue: null,
          proposedValue: "Brand New Article",
        },
        {
          localFieldKey: "prop-body",
          sourceFieldKey: "data.body",
          currentValue: null,
          proposedValue: "Hello body",
        },
      ],
    });
    // The already-linked row with no title change yields nothing.
    expect(
      pending.find((cs) => cs.documentId === "doc-linked"),
    ).toBeUndefined();
  });

  it("does not create a draft for a row imported from Builder even when linkage is missing", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [],
      documentTitleById: new Map([
        ["doc-imported", "Best AI Coding Tools for Developers in 2024"],
      ]),
      storedChangeSets: [],
      databaseItems: [
        { databaseItemId: "item-imported", documentId: "doc-imported" },
      ],
      sourceImportedDocumentIds: new Set(["doc-imported"]),
      bodyChangeByDocumentId: new Map([
        [
          "doc-imported",
          {
            summary: "Builder body blocks changed.",
            currentExcerpt: "",
            proposedExcerpt: "Hydrated body",
            currentHash: null,
            proposedHash: "hydrated-hash",
            proposedContent: "Hydrated body",
            proposedBlocksJson: "[]",
            sidecarsJson: "{}",
            warnings: [],
          },
        ],
      ]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toHaveLength(0);
  });

  it("does NOT diff source-materialized date values after property normalization", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
          sourceValuesJson: JSON.stringify({
            "data.date": "2026-07-02T18:45:00.000Z",
          }),
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        [
          "doc-1",
          new Map([
            ["prop-date", { start: "2026-07-02T18:45", includeTime: true }],
          ]),
        ],
      ]),
      writableFields: [
        {
          propertyId: "prop-date",
          localFieldKey: "prop-date",
          sourceFieldKey: "data.date",
          sourceFieldLabel: "Date",
          propertyType: "date",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toHaveLength(0);
  });

  it("treats duplicate Builder natural keys as ambiguous rather than guessing a row link", () => {
    const entries = [
      {
        id: "entry-1",
        model: "blog-article",
        title: "Duplicate title",
        urlPath: "/duplicate",
        sourceValues: { "data.title": "Duplicate title" },
      },
      {
        id: "entry-2",
        model: "blog-article",
        title: "Duplicate title",
        urlPath: "/duplicate",
        sourceValues: { "data.title": "Duplicate title" },
      },
    ];

    const links = mapBuilderCmsEntriesToLocalItems({
      entries,
      items: [item("doc-1", "Duplicate title")],
      sourceTable: "blog-article",
      now: "2026-07-02T00:00:00.000Z",
      existingRows: [],
    });

    expect(links.size).toBe(0);
  });

  it("does not create rows owned by another source (row-union scoping)", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [],
      documentTitleById: new Map([
        ["doc-mine", "My new row"],
        ["doc-other", "Belongs to another collection"],
      ]),
      storedChangeSets: [],
      databaseItems: [
        { databaseItemId: "item-mine", documentId: "doc-mine" },
        { databaseItemId: "item-other", documentId: "doc-other" },
      ],
      // doc-other is owned by a different source — it must not become a create
      // candidate for this one, even though it isn't in this source's rowRows.
      otherSourceDocumentIds: new Set(["doc-other"]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending.find((cs) => cs.documentId === "doc-mine")).toBeDefined();
    expect(pending.find((cs) => cs.documentId === "doc-other")).toBeUndefined();
  });

  it("a non-primary source adopts a row tagged for it via the Source property", () => {
    // A new, unlinked row tagged for "source-zz" must create against zz even
    // though zz is not the primary (allowUnsourcedCreates: false).
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms", id: "source-zz" },
      rowRows: [],
      documentTitleById: new Map([
        ["doc-zz", "New resource"],
        ["doc-blog", "New blog row"],
      ]),
      storedChangeSets: [],
      databaseItems: [
        { databaseItemId: "item-zz", documentId: "doc-zz" },
        { databaseItemId: "item-blog", documentId: "doc-blog" },
      ],
      allowUnsourcedCreates: false,
      taggedSourceByDocumentId: new Map([
        ["doc-zz", "source-zz"],
        ["doc-blog", "source-blog"],
      ]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    // zz adopts its own tagged row; the row tagged for another collection is
    // left alone even though this is the non-primary source.
    expect(pending.find((cs) => cs.documentId === "doc-zz")).toBeDefined();
    expect(pending.find((cs) => cs.documentId === "doc-blog")).toBeUndefined();
  });

  it("only the primary adopts unsourced rows as creates (allowUnsourcedCreates)", () => {
    const args = {
      source: { sourceType: "builder-cms" },
      rowRows: [],
      documentTitleById: new Map([["doc-local", "Unsourced local row"]]),
      storedChangeSets: [],
      databaseItems: [
        { databaseItemId: "item-local", documentId: "doc-local" },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0];

    // A non-primary source leaves an unsourced "Local" row alone.
    expect(
      buildBuilderLocalOutboundChangeSets({
        ...args,
        allowUnsourcedCreates: false,
      }),
    ).toHaveLength(0);
    // The primary (default) adopts it as a create_draft.
    expect(
      buildBuilderLocalOutboundChangeSets({
        ...args,
        allowUnsourcedCreates: true,
      }).find((cs) => cs.documentId === "doc-local"),
    ).toBeDefined();
  });

  it("skips creates for titleless rows or rows that already have a stored change", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [],
      documentTitleById: new Map([["doc-titled", "Has Title"]]),
      storedChangeSets: [
        {
          direction: "outbound",
          state: "pending_push",
          documentId: "doc-titled",
        },
      ],
      databaseItems: [
        { databaseItemId: "item-empty", documentId: "doc-empty" },
        { databaseItemId: "item-titled", documentId: "doc-titled" },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);
    expect(pending).toHaveLength(0);
  });

  it("does not synthesize live Builder push diffs for legacy fixture rows", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: {
        sourceType: "builder-cms",
        capabilitiesJson: JSON.stringify({ liveWritesEnabled: true }),
        metadataJson: JSON.stringify({ liveReadConfigured: true }),
      },
      rowRows: [
        {
          id: "fixture-row",
          databaseItemId: "item-1",
          documentId: "BU5P0mT9anul",
          sourceDisplayKey: "Old fixture title",
          provenance: "Builder CMS fixture adapter",
        },
        {
          id: "live-row",
          databaseItemId: "item-2",
          documentId: "doc-2",
          sourceDisplayKey: "Old live title",
          provenance: "Builder CMS read adapter",
        },
      ],
      documentTitleById: new Map([
        ["BU5P0mT9anul", "New fixture title"],
        ["doc-2", "New live title"],
      ]),
      storedChangeSets: [],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      documentId: "doc-2",
      fieldChanges: [{ proposedValue: "New live title" }],
    });
  });

  it("recognizes already imported Builder rows by source-qualified identity", () => {
    expect(
      builderCmsEntryAlreadyRepresented({
        sourceTable: "agent-native-blog-article-test",
        entry: {
          id: "builder-entry-1",
          model: "agent-native-blog-article-test",
          title: "A renamed local title",
          urlPath: "/blog/a-renamed-local-title",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
        existingSourceRows: [
          {
            sourceQualifiedId:
              "builder-cms://agent-native-blog-article-test/builder-entry-1",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat legacy fixture-wrapped Builder row IDs as represented live entries", () => {
    expect(
      builderCmsEntryAlreadyRepresented({
        sourceTable: "agent-native-blog-article-test",
        entry: {
          id: "BU5P0mT9anul",
          model: "agent-native-blog-article-test",
          title: "TestName",
          urlPath: "/blog/test-name",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
        existingSourceRows: [
          {
            documentId: "BU5P0mT9anul",
            sourceRowId: "builder-BU5P0mT9anul",
            sourceQualifiedId:
              "builder-cms://agent-native-blog-article-test/builder-BU5P0mT9anul",
            provenance: "Builder CMS fixture adapter",
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not duplicate a Builder title edit that already has a staged outbound record", () => {
    expect(
      buildBuilderLocalOutboundChangeSets({
        source: { sourceType: "builder-cms" },
        rowRows: [
          {
            id: "row-source",
            databaseItemId: "item-1",
            documentId: "doc-1",
            sourceDisplayKey: "Old title",
          },
        ],
        documentTitleById: new Map([["doc-1", "New title"]]),
        storedChangeSets: [
          {
            id: "staged-1",
            databaseItemId: "item-1",
            documentId: "doc-1",
            kind: "field_update",
            direction: "outbound",
            state: "staged_revision",
            pushMode: "autosave",
            localOnly: true,
            summary: "Staged local-only Builder CMS title change.",
            fieldChanges: [
              {
                propertyId: null,
                propertyName: "Title",
                localFieldKey: "title",
                sourceFieldKey: "data.title",
                currentValue: "Old title",
                proposedValue: "New title",
              },
            ],
            bodyChange: null,
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:00.000Z",
          },
        ],
      } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]),
    ).toEqual([]);
  });

  it("surfaces a new pending Builder title edit after an older staged record", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Old title",
        },
      ],
      documentTitleById: new Map([["doc-1", "Newest title"]]),
      storedChangeSets: [
        {
          id: "staged-1",
          databaseItemId: "item-1",
          documentId: "doc-1",
          kind: "field_update",
          direction: "outbound",
          state: "staged_revision",
          pushMode: "autosave",
          localOnly: true,
          summary: "Staged local-only Builder CMS title change.",
          fieldChanges: [
            {
              propertyId: null,
              propertyName: "Title",
              localFieldKey: "title",
              sourceFieldKey: "data.title",
              currentValue: "Old title",
              proposedValue: "Older local title",
            },
          ],
          bodyChange: null,
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending[0]).toMatchObject({
      state: "pending_push",
      fieldChanges: [{ proposedValue: "Newest title" }],
    });
  });

  it("resurfaces a pending Builder title edit after a rejected outbound record", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Old title",
        },
      ],
      documentTitleById: new Map([["doc-1", "Rejected local title"]]),
      storedChangeSets: [
        {
          id: "rejected-1",
          databaseItemId: "item-1",
          documentId: "doc-1",
          kind: "field_update",
          direction: "outbound",
          state: "rejected",
          pushMode: "autosave",
          localOnly: true,
          summary: "Rejected local-only Builder CMS title change.",
          fieldChanges: [
            {
              propertyId: null,
              propertyName: "Title",
              localFieldKey: "title",
              sourceFieldKey: "data.title",
              currentValue: "Old title",
              proposedValue: "Rejected local title",
            },
          ],
          bodyChange: null,
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending[0]).toMatchObject({
      state: "pending_push",
      fieldChanges: [{ proposedValue: "Rejected local title" }],
    });
  });

  it("maps live Builder entries to local rows by Builder ID before natural key", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-existing",
          model: "blog_article",
          title: "Remote existing title",
          urlPath: "/blog/not-the-local-title",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
        {
          id: "builder-natural-key",
          model: "blog_article",
          title: "Natural key title",
          urlPath: "/blog/local-natural-title",
          updatedAt: "2026-06-08T12:30:00.000Z",
        },
      ],
      items: [
        item("doc-existing", "Local existing title"),
        item("doc-natural", "Local natural title"),
      ],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [
        {
          documentId: "doc-existing",
          sourceRowId: "builder-existing",
          sourceQualifiedId: "builder-cms://blog_article/builder-existing",
        },
      ] as Parameters<
        typeof mapBuilderCmsEntriesToLocalItems
      >[0]["existingRows"],
    });

    expect(mapped.get("doc-existing")?.id).toBe("builder-existing");
    expect(mapped.get("doc-natural")?.id).toBe("builder-natural-key");
  });

  it("matches imported Builder entries by title when no row identity exists yet", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-same-title",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/different-natural-key",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
      ],
      items: [item("doc-title-only", "Same title")],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [],
    });

    expect(mapped.get("doc-title-only")?.id).toBe("builder-same-title");
  });

  it("does not bind live Builder entries by ambiguous title or URL fallbacks", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-duplicate-url-1",
          model: "blog_article",
          title: "Remote one",
          urlPath: "/blog/ambiguous",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
        {
          id: "builder-duplicate-url-2",
          model: "blog_article",
          title: "Remote two",
          urlPath: "/blog/ambiguous",
          updatedAt: "2026-06-08T12:05:00.000Z",
        },
        {
          id: "builder-duplicate-title-1",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/not-local-title-1",
          updatedAt: "2026-06-08T12:10:00.000Z",
        },
        {
          id: "builder-duplicate-title-2",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/not-local-title-2",
          updatedAt: "2026-06-08T12:15:00.000Z",
        },
      ],
      items: [
        item("doc-ambiguous", "Ambiguous"),
        item("doc-title-only", "Same title"),
      ],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [],
    });

    expect(mapped.has("doc-ambiguous")).toBe(false);
    expect(mapped.has("doc-title-only")).toBe(false);
  });

  it("keeps persisted Builder identity matches even when fallback keys are ambiguous", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-existing",
          model: "blog_article",
          title: "Duplicate title",
          urlPath: "/blog/duplicate-url",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
        {
          id: "builder-other",
          model: "blog_article",
          title: "Duplicate title",
          urlPath: "/blog/duplicate-url",
          updatedAt: "2026-06-08T12:05:00.000Z",
        },
      ],
      items: [item("doc-existing", "Duplicate title")],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [
        {
          documentId: "doc-existing",
          sourceRowId: "builder-existing",
          sourceQualifiedId: "builder-cms://blog_article/builder-existing",
        },
      ] as Parameters<
        typeof mapBuilderCmsEntriesToLocalItems
      >[0]["existingRows"],
    });

    expect(mapped.get("doc-existing")?.id).toBe("builder-existing");
  });

  it("uses fixture Builder source values when no live entry or snapshot exists", () => {
    expect(
      sourceValuesForSeededSourceRow({
        sourceType: "builder-cms",
        item: item("Doc Fixture", "Fixture title"),
        sourceTable: "blog_article",
        now: "2026-06-08T13:00:00.000Z",
      }),
    ).toMatchObject({
      "data.title": "Fixture title",
      "data.url": "/blog/fixture-title",
      lastUpdated: "2026-06-08T13:00:00.000Z",
    });
  });

  it("preserves existing source values before falling back to fixture values", () => {
    expect(
      sourceValuesForSeededSourceRow({
        sourceType: "builder-cms",
        item: item("Doc Fixture", "Fixture title"),
        sourceTable: "blog_article",
        now: "2026-06-08T13:00:00.000Z",
        existingSourceValuesJson: JSON.stringify({
          "data.url": "/blog/persisted-url",
        }),
      }),
    ).toEqual({
      "data.url": "/blog/persisted-url",
    });
  });

  it("preserves a hydrated Builder body baseline across metadata-only refreshes with the same hash", () => {
    expect(
      sourceValuesForSeededSourceRow({
        sourceType: "builder-cms",
        item: item("doc-1", "Same title"),
        sourceTable: "blog_article",
        now: "2026-06-08T13:00:00.000Z",
        builderEntry: {
          id: "entry-1",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/same-title",
          updatedAt: "2026-06-08T13:00:00.000Z",
          sourceValues: {
            "data.title": "Same title",
            [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "same-body-hash",
          },
        },
        existingSourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "same-body-hash",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated baseline",
          [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "Lossless baseline",
          [BUILDER_CMS_BODY_READABLE_MAP_KEY]: '{"blocks":[]}',
          [BUILDER_CMS_BODY_SIDECARS_KEY]: "{}",
        }),
      }),
    ).toMatchObject({
      "data.title": "Same title",
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "same-body-hash",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated baseline",
      [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "Lossless baseline",
      [BUILDER_CMS_BODY_READABLE_MAP_KEY]: '{"blocks":[]}',
      [BUILDER_CMS_BODY_SIDECARS_KEY]: "{}",
    });
  });

  it("drops a hydrated Builder body baseline when metadata reports a different hash", () => {
    expect(
      sourceValuesForSeededSourceRow({
        sourceType: "builder-cms",
        item: item("doc-1", "Same title"),
        sourceTable: "blog_article",
        now: "2026-06-08T13:00:00.000Z",
        builderEntry: {
          id: "entry-1",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/same-title",
          updatedAt: "2026-06-08T13:00:00.000Z",
          sourceValues: {
            "data.title": "Same title",
            [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "new-body-hash",
          },
        },
        existingSourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "old-body-hash",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated baseline",
        }),
      }),
    ).toEqual({
      "data.title": "Same title",
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "new-body-hash",
    });
  });

  it("summarizes proposed changes with the current row title and changed field names", () => {
    const headline = property("text", "Launch week");
    const fieldChange = buildMockFieldChange({
      property: headline,
      currentValue: headline.value,
    });

    expect(
      sourceChangeSetSummary({
        itemTitle: "Alph",
        fieldChanges: [fieldChange],
        bodyChange: null,
      }),
    ).toBe('Review mock source field change for "Alph" (Headline).');
    expect(
      sourceChangeSetSummary({
        itemTitle: "Alph",
        fieldChanges: [fieldChange],
        bodyChange: buildMockBodyChange("First paragraph."),
      }),
    ).toBe('Review mock source body changes for "Alph".');
  });
});
