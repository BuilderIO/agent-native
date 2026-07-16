import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseItem,
  ContentDatabaseSourceChangeSet,
  DocumentProperty,
} from "../shared/api";
import { builderBlocksHash } from "../shared/builder-mdx";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LAST_UPDATED_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_FIXTURE_ROW_PROVENANCE,
} from "./_builder-cms-source-adapter";
import { resolveBuilderCmsWriteEffect } from "./_builder-cms-write-adapter";
import {
  buildBuilderLocalOutboundChangeSets,
  builderBodyChangeForLocalContent,
  builderBodyChangeForSourceSnapshotDocument,
  builderBodyChangeForUnsourcedLocalCreate,
  builderBodyHydrationPriorityForRequest,
  builderBodyHydrationAttemptIsTerminal,
  builderBodyNeedsSourceComponentWrite,
  builderBodyHydrationVersion,
  builderBodyUnavailableVersion,
  builderBodyHydrationNeedsLiveBaseline,
  builderBodyHydrationIsCodecMigration,
  builderBodyHydrationCanAdoptSameVersionVariant,
  builderBodyBaselineHasSameVersionConflict,
  builderAuthoritativeRawBodyHash,
  bulkChunkSizeForColumnCount,
  builderCmsEntryAlreadyRepresented,
  builderExecutionIsProvablyLocallyBlockedUnsent,
  canRefreshLocallyBlockedBuilderReview,
  buildMockBodyChange,
  buildMockFieldChange,
  withBuilderBodySourceValues,
  mapBuilderCmsEntriesToLocalItems,
  mergeBuilderCmsModelFieldsPreservingReferenceModels,
  mockProposedValue,
  normalizeSourceFederation,
  normalizeSourceFreshness,
  refreshBuilderBodySourceValuesFromStoredLossless,
  serializeBuilderCmsSourceReadMetadataRecord,
  serializeSourceMetadataRecord,
  sourceSnapshotValuesJsonProjectionSql,
  sourceSnapshotDocumentSelection,
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
  it("selects document bodies only for explicitly heavy Builder snapshots", () => {
    expect(sourceSnapshotDocumentSelection(false)).not.toHaveProperty(
      "content",
    );
    expect(sourceSnapshotDocumentSelection(true)).toHaveProperty("content");
  });

  it("refreshes only execution evidence that proves dispatch never started", () => {
    const locallyBlocked = {
      state: "blocked",
      attemptToken: null,
      payloadJson: JSON.stringify({
        request: { method: "POST" },
        dryRun: { status: "blocked" },
      }),
    };
    expect(builderExecutionIsProvablyLocallyBlockedUnsent(locallyBlocked)).toBe(
      true,
    );
    expect(canRefreshLocallyBlockedBuilderReview([])).toBe(true);
    expect(canRefreshLocallyBlockedBuilderReview([locallyBlocked])).toBe(true);
    expect(
      builderExecutionIsProvablyLocallyBlockedUnsent({
        ...locallyBlocked,
        payloadJson: JSON.stringify({
          dryRun: { status: "validated" },
          livePreflight: { blocksHash: "new-live-hash" },
        }),
      }),
    ).toBe(true);

    for (const execution of [
      { ...locallyBlocked, state: "running" },
      { ...locallyBlocked, state: "response_received" },
      { ...locallyBlocked, state: "reconciliation_required" },
      { ...locallyBlocked, state: "failed", attemptToken: "attempt-1" },
      {
        ...locallyBlocked,
        payloadJson: JSON.stringify({
          dryRun: { status: "blocked" },
          response: { status: 201 },
        }),
      },
    ]) {
      expect(builderExecutionIsProvablyLocallyBlockedUnsent(execution)).toBe(
        false,
      );
      expect(canRefreshLocallyBlockedBuilderReview([execution])).toBe(false);
    }
  });

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

  it("strips heavy Builder bodies in the database snapshot projection", () => {
    const sqliteProjection = sourceSnapshotValuesJsonProjectionSql("sqlite");
    const postgresProjection =
      sourceSnapshotValuesJsonProjectionSql("postgres");

    expect(sqliteProjection).toContain("json_remove");
    expect(postgresProjection).toContain("::jsonb");
    for (const key of [
      BUILDER_CMS_BODY_CONTENT_KEY,
      BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
      BUILDER_CMS_BODY_READABLE_MAP_KEY,
      BUILDER_CMS_BODY_SIDECARS_KEY,
    ]) {
      expect(sqliteProjection).toContain(key);
      expect(postgresProjection).toContain(key);
    }
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

  it("records suspicious empty Builder reads without calling them healthy", () => {
    expect(
      JSON.parse(
        serializeBuilderCmsSourceReadMetadataRecord({
          sourceTable: "blog-article",
          readState: "live",
          entryCount: 0,
          matchedRowCount: 0,
          suspiciousEmpty: true,
          sourceFetchState: "error",
        }),
      ),
    ).toMatchObject({
      liveReadConfigured: true,
      lastReadEntryCount: 0,
      lastReadSuspiciousEmpty: true,
      sourceFetchState: "error",
      activeReadSourceRowIds: [],
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

  it("preserves the configured Builder write tier during read metadata refreshes", () => {
    expect(
      JSON.parse(
        serializeBuilderCmsSourceReadMetadataRecord({
          sourceTable: "agent-native-blog-article-test",
          readState: "live",
          entryCount: 580,
          matchedRowCount: 580,
          existingMetadataJson: JSON.stringify({
            writeMode: "publish_updates",
            pushMode: "publish",
            pushModeLabel: "Publish updates",
            allowPublicationTransitions: true,
            allowedWriteModes: ["autosave", "publish"],
          }),
        }),
      ),
    ).toMatchObject({
      writeMode: "publish_updates",
      pushMode: "publish",
      pushModeLabel: "Publish updates",
      allowPublicationTransitions: true,
      allowedWriteModes: ["autosave", "publish"],
      readMode: "builder-api",
    });
  });

  it("preserves a raw-reference model learned during required-field materialization", () => {
    expect(
      mergeBuilderCmsModelFieldsPreservingReferenceModels({
        existing: [
          {
            name: "author",
            type: "reference",
            required: true,
            model: "blog-author",
          },
        ],
        refreshed: [
          { name: "author", type: "reference", required: true },
          { name: "tags", type: "Tags", required: true },
        ],
      }),
    ).toEqual([
      {
        name: "author",
        type: "reference",
        required: true,
        model: "blog-author",
      },
      { name: "tags", type: "Tags", required: true },
    ]);
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
    ).toBe(
      "blocks-hash-1:readable-native-images-authoritative-raw-baseline-v9",
    );
  });

  it("versions terminal bodyless entries by remote update instead of an empty-body hash", () => {
    expect(
      builderBodyUnavailableVersion({
        id: "entry-1",
        title: "Bodyless entry",
        updatedAt: "2026-06-30T00:00:00.000Z",
        sourceValues: {
          lastUpdated: "1783976416742",
          "__builder.body.blocksHash": "empty-body-hash",
        },
      }),
    ).toBe(
      "1783976416742:readable-native-images-authoritative-raw-baseline-v9",
    );
  });

  it("requires a live baseline when migrating a stored body codec or repairing a hash", () => {
    expect(
      builderBodyHydrationNeedsLiveBaseline({
        bodyHydrationVersion:
          "old-hash:readable-native-images-canonical-pixel-v6",
        storedBlocksHash: "old-hash",
        rebuiltBlocksHash: "old-hash",
      }),
    ).toBe(true);
    expect(
      builderBodyHydrationNeedsLiveBaseline({
        bodyHydrationVersion:
          "old-hash:readable-native-images-authoritative-raw-baseline-v9",
        storedBlocksHash: "old-hash",
        rebuiltBlocksHash: "rebuilt-hash",
      }),
    ).toBe(true);
    expect(
      builderBodyHydrationNeedsLiveBaseline({
        bodyHydrationVersion:
          "stable-hash:readable-native-images-authoritative-raw-baseline-v9",
        storedBlocksHash: "stable-hash",
        rebuiltBlocksHash: "stable-hash",
      }),
    ).toBe(false);
    expect(
      builderBodyHydrationNeedsLiveBaseline({
        bodyHydrationVersion:
          "stable-hash:readable-native-images-authoritative-raw-baseline-v9",
        storedBlocksHash: "stable-hash",
        rebuiltBlocksHash: null,
      }),
    ).toBe(true);
  });

  it("allows a bad v8 hash to migrate once while keeping v9 conflicts fail-closed", () => {
    expect(
      builderBodyHydrationIsCodecMigration(
        "2abdywxepbd:readable-native-images-fresh-raw-baseline-v8",
      ),
    ).toBe(true);
    expect(
      builderBodyHydrationIsCodecMigration(
        "15ed04whkyf:readable-native-images-authoritative-raw-baseline-v9",
      ),
    ).toBe(false);
  });

  it("adopts a same-version live body variant only while the local document still matches its stored baseline", () => {
    expect(
      builderBodyHydrationCanAdoptSameVersionVariant({
        documentContent: "Imported body\n",
        persistedContent: "Imported body",
      }),
    ).toBe(true);
    expect(
      builderBodyHydrationCanAdoptSameVersionVariant({
        documentContent: "Local edit",
        persistedContent: "Imported body",
      }),
    ).toBe(false);
    expect(
      builderBodyHydrationCanAdoptSameVersionVariant({
        documentContent: undefined,
        persistedContent: "Imported body",
      }),
    ).toBe(false);
  });

  it("hashes the post-publish raw response instead of a normalized body bundle", () => {
    const rawBlocks = Array.from({ length: 17 }, (_, index) => ({
      "@type": "@builder.io/sdk:Element",
      id: `published-rich-${index + 1}`,
      component: {
        name: index === 15 ? "Image" : index === 16 ? "Video" : "Text",
        options: { text: `Published section ${index + 1}` },
      },
    }));
    const normalizedOldVariant = rawBlocks.slice(0, 5).map((block, index) => ({
      ...block,
      id: `normalized-old-${index + 1}`,
    }));
    const rawHash = builderBlocksHash(rawBlocks);
    const normalizedHash = builderBlocksHash(normalizedOldVariant);
    expect(rawHash).not.toBe(normalizedHash);

    expect(
      builderAuthoritativeRawBodyHash({
        entry: {
          id: "published-target",
          model: "agent-native-blog-article-test",
          title: "Quiet Comet",
          urlPath: "/quiet-comet",
          updatedAt: "1784009460665",
          sourceValues: {},
          rawEntry: {
            id: "published-target",
            model: "agent-native-blog-article-test",
            published: "published",
            lastUpdated: "1784009460665",
            data: { blocks: rawBlocks },
          },
        },
        generatedBlocks: normalizedOldVariant,
      }),
    ).toBe(rawHash);
  });

  it("detects conflicting Builder bodies at the same authoritative timestamp", () => {
    expect(
      builderBodyBaselineHasSameVersionConflict({
        persistedBlocksHash: "published-rich-hash",
        incomingBlocksHash: "stale-public-hash",
        persistedLastUpdated: "1784009460665",
        incomingLastUpdated: "2026-07-14T06:11:00.665Z",
      }),
    ).toBe(true);
    expect(
      builderBodyBaselineHasSameVersionConflict({
        persistedBlocksHash: "published-rich-hash",
        incomingBlocksHash: "new-remote-hash",
        persistedLastUpdated: "1784009460665",
        incomingLastUpdated: "1784009461665",
      }),
    ).toBe(false);
  });

  it("recomputes a canonical remote hash from the stored lossless baseline", async () => {
    const authoredBlock = {
      "@type": "@builder.io/sdk:Element",
      "@version": 2,
      id: "authored-text-1",
      component: {
        name: "Text",
        options: { text: "<p>Remote baseline.</p>" },
      },
    };
    const trackingPixel = {
      "@type": "@builder.io/sdk:Element",
      id: "builder-pixel-old-response",
      tagName: "img",
      properties: {
        src: "https://cdn.builder.io/api/v1/pixel?apiKey=public-key",
        "aria-hidden": "true",
        alt: "",
        role: "presentation",
        width: "0",
        height: "0",
      },
    };
    const hydrated = await withBuilderBodySourceValues({
      id: "entry-1",
      model: "agent-native-blog-article-test",
      title: "Entry",
      urlPath: "/entry",
      updatedAt: "2026-07-14T00:00:00.000Z",
      sourceValues: {},
      rawEntry: {
        id: "entry-1",
        model: "agent-native-blog-article-test",
        data: { blocks: [authoredBlock, trackingPixel] },
      },
    });
    const repaired = await refreshBuilderBodySourceValuesFromStoredLossless({
      ...hydrated,
      rawEntry: undefined,
      sourceValues: {
        ...hydrated.sourceValues,
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "legacy-pixel-sensitive-hash",
      },
    });

    expect(repaired.sourceValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe(
      builderBlocksHash([authoredBlock]),
    );
    expect(repaired.sourceValues[BUILDER_CMS_BODY_CONTENT_KEY]).toContain(
      "Remote baseline.",
    );
    expect(repaired.sourceValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]).toBe(
      hydrated.sourceValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY],
    );
  });

  it("never replaces a fresh raw Builder hash with a divergent lossless rebuild", async () => {
    const storedOnly = await withBuilderBodySourceValues({
      id: "stored-entry",
      model: "agent-native-blog-article-test",
      title: "Stored",
      urlPath: "/stored",
      updatedAt: "2026-07-14T00:00:00.000Z",
      sourceValues: {},
      rawEntry: {
        id: "stored-entry",
        model: "agent-native-blog-article-test",
        data: {
          blocks: [
            {
              "@type": "@builder.io/sdk:Element",
              id: "stored-text",
              component: {
                name: "Text",
                options: { text: "<p>Different stored lossless body.</p>" },
              },
            },
          ],
        },
      },
    });
    const freshRawBlock = {
      "@type": "@builder.io/sdk:Element",
      id: "fresh-text",
      component: {
        name: "Text",
        options: { text: "<p>Fresh raw Builder body.</p>" },
      },
    };
    const freshRawHash = builderBlocksHash([freshRawBlock]);
    const freshEntry = {
      ...storedOnly,
      id: "fresh-entry",
      rawEntry: {
        id: "fresh-entry",
        model: "agent-native-blog-article-test",
        data: { blocks: [freshRawBlock] },
      },
      sourceValues: {
        ...storedOnly.sourceValues,
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: freshRawHash,
      },
    };

    const result =
      await refreshBuilderBodySourceValuesFromStoredLossless(freshEntry);

    expect(result.sourceValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe(
      freshRawHash,
    );
    expect(result.sourceValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]).toBe(
      storedOnly.sourceValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY],
    );
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

  it("uses Builder data.title as the outbound title baseline", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey:
            "How to evaluate vibe coding tools for your enterprise",
          sourceValuesJson: JSON.stringify({
            "data.title":
              "How to Evaluate Vibe Coding Tools for Your Enterprise",
          }),
        },
      ],
      documentTitleById: new Map([
        ["doc-1", "How to Evaluate Vibe Coding Tools for Your Enterprise"],
      ]),
      storedChangeSets: [],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toHaveLength(0);
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
      id: "local-pending-row-source-change",
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

    const [fieldOnlyChangeSet] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
        },
      ],
      documentTitleById: new Map([["doc-1", "Changed title"]]),
      storedChangeSets: [],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);
    expect(fieldOnlyChangeSet?.id).toBe(changeSet?.id);
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

  it("stages Quiet Comet converter-only native media drift once, then reaches a fixpoint", async () => {
    const localContent = [
      "![Quiet Comet](https://cdn.example.com/quiet-comet.png)",
      "",
      '<video src="https://cdn.example.com/quiet-comet.mp4" controls></video>',
    ].join("\n");
    const staleRemote = await withBuilderBodySourceValues({
      id: "quiet-comet",
      model: "agent-native-blog-article-test",
      title: "Quiet Comet",
      urlPath: "/quiet-comet",
      updatedAt: "2026-07-13T00:00:00.000Z",
      sourceValues: { "data.title": "Quiet Comet" },
      rawEntry: {
        id: "quiet-comet",
        model: "agent-native-blog-article-test",
        data: {
          title: "Quiet Comet",
          blocks: [
            {
              "@type": "@builder.io/sdk:Element",
              "@version": 2,
              id: "legacy-literal-media",
              component: {
                name: "Text",
                options: {
                  text: `<p>${localContent}</p>`,
                },
              },
            },
          ],
        },
      },
    });

    const change = await builderBodyChangeForLocalContent({
      row: { sourceValuesJson: JSON.stringify(staleRemote.sourceValues) },
      localContent,
    });
    const generatedBlocks = JSON.parse(
      change?.proposedBlocksJson ?? "null",
    ) as Array<{ component?: { name?: string } }>;

    expect(change).toMatchObject({
      summary: "Builder body blocks changed.",
      proposedContent: localContent,
      warnings: [],
    });
    expect(change?.proposedHash).not.toBe(change?.currentHash);
    expect(generatedBlocks.map((block) => block.component?.name)).toEqual([
      "Image",
      "Video",
    ]);

    const [linkedUpdate] = buildBuilderLocalOutboundChangeSets({
      source: {
        id: "source-quiet-comet",
        sourceType: "builder-cms",
        metadataJson: JSON.stringify({ writeMode: "publish_updates" }),
      },
      rowRows: [
        {
          id: "row-quiet-comet",
          databaseItemId: "item-quiet-comet",
          documentId: "doc-quiet-comet",
          sourceRowId: "quiet-comet",
          sourceQualifiedId:
            "builder-cms://agent-native-blog-article-test/quiet-comet",
          sourceDisplayKey: "Quiet Comet",
          sourceValuesJson: JSON.stringify(staleRemote.sourceValues),
        },
      ],
      documentTitleById: new Map([["doc-quiet-comet", "Quiet Comet"]]),
      storedChangeSets: [],
      bodyChangeByDocumentId: new Map([["doc-quiet-comet", change!]]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);
    expect(linkedUpdate.summary).toBe(
      'Pending local Builder CMS body change for "Quiet Comet".',
    );
    expect(
      resolveBuilderCmsWriteEffect({
        source: {
          metadata: { writeMode: "publish_updates" },
          rows: [
            {
              documentId: "doc-quiet-comet",
              sourceRowId: "quiet-comet",
            },
          ],
        },
        changeSet: linkedUpdate,
      } as Parameters<typeof resolveBuilderCmsWriteEffect>[0]),
    ).toBe("update_in_place");

    const reconciledRemote = await withBuilderBodySourceValues({
      id: "quiet-comet",
      model: "agent-native-blog-article-test",
      title: "Quiet Comet",
      urlPath: "/quiet-comet",
      updatedAt: "2026-07-13T00:01:00.000Z",
      sourceValues: { "data.title": "Quiet Comet" },
      rawEntry: {
        id: "quiet-comet",
        model: "agent-native-blog-article-test",
        data: { title: "Quiet Comet", blocks: generatedBlocks },
      },
    });
    await expect(
      builderBodyChangeForLocalContent({
        row: {
          sourceValuesJson: JSON.stringify(reconciledRemote.sourceValues),
        },
        localContent,
      }),
    ).resolves.toBeNull();
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

  it("converts a rich unsourced local body into a create-draft body payload", async () => {
    const localContent = [
      "Opening paragraph.",
      "",
      "- First semantic item",
      "- Second semantic item",
      "",
      '<img src="https://cdn.example.com/diagram.png" alt="Architecture diagram" width="420" />',
      "",
      '<video src="https://cdn.example.com/demo.mp4" controls width="640"></video>',
      "",
      "[Watch the walkthrough on YouTube](https://www.youtube.com/watch?v=abc123)",
    ].join("\n");

    const bodyChange = await builderBodyChangeForUnsourcedLocalCreate({
      localContent,
    });
    const blocks = JSON.parse(
      bodyChange?.proposedBlocksJson ?? "null",
    ) as Array<{
      component?: { name?: string; options?: Record<string, unknown> };
    }>;
    const textHtml = blocks
      .filter((block) => block.component?.name === "Text")
      .map((block) => String(block.component?.options?.text ?? ""))
      .join("\n");
    const image = blocks.find(
      (block) => block.component?.name === "Image",
    )?.component;
    const video = blocks.find(
      (block) => block.component?.name === "Video",
    )?.component;

    expect(bodyChange).toMatchObject({
      currentHash: null,
      proposedContent: localContent,
      sidecarsJson: "{}",
      warnings: [],
    });
    expect(bodyChange?.proposedHash).toBeTruthy();
    expect(textHtml).toContain("<p>Opening paragraph.</p>");
    expect(textHtml).toContain(
      "<ul><li>First semantic item</li><li>Second semantic item</li></ul>",
    );
    expect(textHtml).toContain(
      '<a href="https://www.youtube.com/watch?v=abc123">Watch the walkthrough on YouTube</a>',
    );
    expect(image).toMatchObject({
      name: "Image",
      options: {
        image: "https://cdn.example.com/diagram.png",
        altText: "Architecture diagram",
      },
    });
    expect(video).toMatchObject({
      name: "Video",
      options: {
        video: "https://cdn.example.com/demo.mp4",
        controls: true,
      },
    });

    const [create] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [],
      documentTitleById: new Map([["doc-new", "Rich new article"]]),
      storedChangeSets: [],
      databaseItems: [{ databaseItemId: "item-new", documentId: "doc-new" }],
      allowUnsourcedCreates: true,
      bodyChangeByDocumentId: new Map([["doc-new", bodyChange!]]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(create).toMatchObject({
      documentId: "doc-new",
      summary: 'Pending new Builder entry "Rich new article".',
      bodyChange: {
        proposedContent: localContent,
        sidecarsJson: "{}",
      },
    });
  });

  it("treats a synthetic Builder fixture row body as create-draft content before hydration", async () => {
    const documentId = "doc-fixture-create";
    const bodyChange = await builderBodyChangeForSourceSnapshotDocument({
      row: {
        documentId,
        sourceRowId: `builder-${documentId}`,
        sourceQualifiedId: `builder-cms://blog-article/${documentId}`,
        provenance: BUILDER_CMS_FIXTURE_ROW_PROVENANCE,
        sourceValuesJson: JSON.stringify({ "data.title": "Fixture title" }),
      },
      isHydrated: false,
      allowUnsourcedCreate: false,
      localContent: "Local draft body with **rich text**.",
    });

    expect(bodyChange).toMatchObject({
      currentHash: null,
      proposedContent: "Local draft body with **rich text**.",
      sidecarsJson: "{}",
      warnings: [],
    });
  });

  it("keeps an unhydrated imported Builder row body fail-closed", async () => {
    const bodyChange = await builderBodyChangeForSourceSnapshotDocument({
      row: {
        documentId: "doc-imported",
        sourceRowId: "real-builder-entry-id",
        sourceQualifiedId: "builder-cms://blog-article/real-builder-entry-id",
        provenance: "Builder CMS read adapter",
        sourceValuesJson: JSON.stringify({
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "remote-baseline-hash",
        }),
      },
      isHydrated: false,
      allowUnsourcedCreate: true,
      localContent: "Content that must not be reinterpreted as a create.",
    });

    expect(bodyChange).toBeNull();
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

  it("does not diff Builder option labels from equivalent local IDs or multi-select order", () => {
    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
          sourceValuesJson: JSON.stringify({
            "data.status": "In review",
            "data.topics": ["Headless CMS", "Agent workflows"],
          }),
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        [
          "doc-1",
          new Map([
            ["prop-status", "in-review"],
            ["prop-topics", ["agent-workflows", "headless-cms"]],
          ]),
        ],
      ]),
      writableFields: [
        {
          propertyId: "prop-status",
          localFieldKey: "prop-status",
          sourceFieldKey: "data.status",
          sourceFieldLabel: "Status",
          propertyType: "select",
          propertyOptions: {
            options: [{ id: "in-review", name: "In review", color: "blue" }],
          },
        },
        {
          propertyId: "prop-topics",
          localFieldKey: "prop-topics",
          sourceFieldKey: "data.topics",
          sourceFieldLabel: "Topics",
          propertyType: "multi_select",
          propertyOptions: {
            options: [
              { id: "headless-cms", name: "Headless CMS", color: "blue" },
              {
                id: "agent-workflows",
                name: "Agent workflows",
                color: "green",
              },
            ],
          },
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toHaveLength(0);
  });

  it("still diffs real Builder select and multi-select edits after option canonicalization", () => {
    const [changeSet] = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Same title",
          sourceValuesJson: JSON.stringify({
            "data.status": "Draft",
            "data.topics": ["Headless CMS"],
          }),
        },
      ],
      documentTitleById: new Map([["doc-1", "Same title"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        [
          "doc-1",
          new Map([
            ["prop-status", "published"],
            ["prop-topics", ["headless-cms", "agent-workflows"]],
          ]),
        ],
      ]),
      writableFields: [
        {
          propertyId: "prop-status",
          localFieldKey: "prop-status",
          sourceFieldKey: "data.status",
          sourceFieldLabel: "Status",
          propertyType: "select",
          propertyOptions: {
            options: [
              { id: "draft", name: "Draft", color: "gray" },
              { id: "published", name: "Published", color: "green" },
            ],
          },
        },
        {
          propertyId: "prop-topics",
          localFieldKey: "prop-topics",
          sourceFieldKey: "data.topics",
          sourceFieldLabel: "Topics",
          propertyType: "multi_select",
          propertyOptions: {
            options: [
              { id: "headless-cms", name: "Headless CMS", color: "blue" },
              {
                id: "agent-workflows",
                name: "Agent workflows",
                color: "green",
              },
            ],
          },
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(changeSet.fieldChanges).toMatchObject([
      {
        propertyName: "Status",
        currentValue: "draft",
        proposedValue: "published",
      },
      {
        propertyName: "Topics",
        currentValue: ["headless-cms"],
        proposedValue: ["Headless CMS", "Agent workflows"],
        builderValueJson: JSON.stringify(["Headless CMS", "Agent workflows"]),
      },
    ]);
  });

  it("stores human-readable safe-model metadata reviews with exact Builder-native values", () => {
    const [changeSet] = buildBuilderLocalOutboundChangeSets({
      source: {
        id: "safe-source",
        sourceType: "builder-cms",
        metadataJson: JSON.stringify({ liveReadConfigured: true }),
      },
      rowRows: [],
      databaseItems: [{ databaseItemId: "item-new", documentId: "doc-new" }],
      documentTitleById: new Map([["doc-new", "Rich metadata article"]]),
      storedChangeSets: [],
      localValuesByDocument: new Map([
        [
          "doc-new",
          new Map([
            ["prop-date", { start: "2026-07-14", includeTime: false }],
            ["prop-author", "author-entry-id"],
            ["prop-image", ["https://cdn.example.com/cover.jpg"]],
            ["prop-tags", ["agent-native", "builder-sync"]],
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
          sourceFieldType: "datetime",
        },
        {
          propertyId: "prop-author",
          localFieldKey: "prop-author",
          sourceFieldKey: "data.author",
          sourceFieldLabel: "Author",
          propertyType: "select",
          sourceFieldType: "reference",
          sourceFieldModel: "author",
          propertyOptions: {
            options: [
              { id: "author-entry-id", name: "Apoorva", color: "blue" },
            ],
          },
        },
        {
          propertyId: "prop-image",
          localFieldKey: "prop-image",
          sourceFieldKey: "data.image",
          sourceFieldLabel: "Image",
          propertyType: "files_media",
          sourceFieldType: "file",
        },
        {
          propertyId: "prop-tags",
          localFieldKey: "prop-tags",
          sourceFieldKey: "data.tags",
          sourceFieldLabel: "Tags",
          propertyType: "multi_select",
          sourceFieldType: "list",
          propertyOptions: {
            options: [
              { id: "agent-native", name: "Agent Native", color: "blue" },
              { id: "builder-sync", name: "Builder Sync", color: "green" },
            ],
          },
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(changeSet.fieldChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFieldKey: "data.date",
          builderValueJson: JSON.stringify("2026-07-14"),
        }),
        expect.objectContaining({
          sourceFieldKey: "data.author",
          proposedValue: "Apoorva",
          builderValueJson: JSON.stringify({
            "@type": "@builder.io/core:Reference",
            id: "author-entry-id",
            model: "author",
          }),
        }),
        expect.objectContaining({
          sourceFieldKey: "data.image",
          builderValueJson: JSON.stringify("https://cdn.example.com/cover.jpg"),
        }),
        expect.objectContaining({
          sourceFieldKey: "data.tags",
          proposedValue: ["Agent Native", "Builder Sync"],
          builderValueJson: JSON.stringify(["Agent Native", "Builder Sync"]),
        }),
      ]),
    );
  });

  it.each([
    {
      label: "select",
      propertyType: "select" as const,
      propertyId: "prop-status",
      sourceFieldKey: "data.status",
      sourceFieldLabel: "Status",
      sourceValue: "Draft",
      localValue: "published",
      storedCurrentValue: "Draft",
      storedProposedValue: "Published",
      options: [
        { id: "draft", name: "Draft", color: "gray" },
        { id: "published", name: "Published", color: "green" },
      ],
    },
    {
      label: "multi-select",
      propertyType: "multi_select" as const,
      propertyId: "prop-topics",
      sourceFieldKey: "data.topics",
      sourceFieldLabel: "Topics",
      sourceValue: ["Headless CMS"],
      localValue: ["headless-cms", "agent-workflows"],
      storedCurrentValue: ["Headless CMS"],
      storedProposedValue: ["Agent workflows", "Headless CMS"],
      options: [
        { id: "headless-cms", name: "Headless CMS", color: "blue" },
        {
          id: "agent-workflows",
          name: "Agent workflows",
          color: "green",
        },
      ],
    },
  ])(
    "does not duplicate legacy label-based Builder $label reviews",
    ({
      propertyType,
      propertyId,
      sourceFieldKey,
      sourceFieldLabel,
      sourceValue,
      localValue,
      storedCurrentValue,
      storedProposedValue,
      options,
    }) => {
      const pending = buildBuilderLocalOutboundChangeSets({
        source: { sourceType: "builder-cms" },
        rowRows: [
          {
            id: "row-source",
            databaseItemId: "item-1",
            documentId: "doc-1",
            sourceDisplayKey: "Same title",
            sourceValuesJson: JSON.stringify({
              [sourceFieldKey]: sourceValue,
            }),
          },
        ],
        documentTitleById: new Map([["doc-1", "Same title"]]),
        localValuesByDocument: new Map([
          ["doc-1", new Map([[propertyId, localValue]])],
        ]),
        writableFields: [
          {
            propertyId,
            localFieldKey: propertyId,
            sourceFieldKey,
            sourceFieldLabel,
            propertyType,
            propertyOptions: { options },
          },
        ],
        storedChangeSets: [
          {
            id: "legacy-pending-1",
            databaseItemId: "item-1",
            documentId: "doc-1",
            kind: "field_update",
            direction: "outbound",
            state: "pending_push",
            pushMode: "autosave",
            localOnly: true,
            summary: "Pending local Builder CMS changes.",
            fieldChanges: [
              {
                propertyId,
                propertyName: sourceFieldLabel,
                localFieldKey: propertyId,
                sourceFieldKey,
                currentValue: storedCurrentValue,
                proposedValue: storedProposedValue,
              },
            ],
            bodyChange: null,
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
          },
        ],
      } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

      expect(pending).toHaveLength(0);
    },
  );

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

  it("suppresses the exact unchanged snapshot after a prepared Builder update is cancelled", () => {
    const rejected = {
      id: "cancelled-1",
      databaseItemId: "item-1",
      documentId: "doc-1",
      kind: "field_update",
      direction: "outbound",
      state: "rejected",
      pushMode: "autosave",
      localOnly: true,
      summary: "Prepared title update.",
      fieldChanges: [
        {
          propertyId: null,
          propertyName: "Title",
          localFieldKey: "title",
          sourceFieldKey: "data.title",
          currentValue: "Remote title",
          proposedValue: "Local title",
        },
      ],
      bodyChange: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:01:00.000Z",
    } as ContentDatabaseSourceChangeSet;

    const pending = buildBuilderLocalOutboundChangeSets({
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-source",
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceDisplayKey: "Remote title",
        },
      ],
      documentTitleById: new Map([["doc-1", "Local title"]]),
      storedChangeSets: [rejected],
      cancelledRejectedChangeSetIds: new Set([rejected.id]),
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

    expect(pending).toEqual([]);
  });

  it.each([
    ["local", "Remote title", "Changed local title"],
    ["remote", "Changed remote title", "Local title"],
  ])(
    "resurfaces a cancelled Builder diff when %s relevant content changes",
    (_side, remoteTitle, localTitle) => {
      const rejected = {
        id: "cancelled-1",
        databaseItemId: "item-1",
        documentId: "doc-1",
        kind: "field_update",
        direction: "outbound",
        state: "rejected",
        pushMode: "autosave",
        localOnly: true,
        summary: "Prepared title update.",
        fieldChanges: [
          {
            propertyId: null,
            propertyName: "Title",
            localFieldKey: "title",
            sourceFieldKey: "data.title",
            currentValue: "Remote title",
            proposedValue: "Local title",
          },
        ],
        bodyChange: null,
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:01:00.000Z",
      } as ContentDatabaseSourceChangeSet;

      const pending = buildBuilderLocalOutboundChangeSets({
        source: { sourceType: "builder-cms" },
        rowRows: [
          {
            id: "row-source",
            databaseItemId: "item-1",
            documentId: "doc-1",
            sourceDisplayKey: remoteTitle,
          },
        ],
        documentTitleById: new Map([["doc-1", localTitle]]),
        storedChangeSets: [rejected],
        cancelledRejectedChangeSetIds: new Set([rejected.id]),
      } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0]);

      expect(pending).toHaveLength(1);
      expect(pending[0]?.fieldChanges).toMatchObject([
        { currentValue: remoteTitle, proposedValue: localTitle },
      ]);
    },
  );

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

  it("does not rebind an established Builder row during a partial read", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-same-title-neighbor",
          model: "blog_article",
          title: "Same title",
          urlPath: "/blog/same-title",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
      ],
      items: [item("doc-established", "Same title")],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [
        {
          documentId: "doc-established",
          sourceRowId: "builder-established-not-on-this-page",
          sourceQualifiedId:
            "builder-cms://blog_article/builder-established-not-on-this-page",
          provenance: "Builder CMS read adapter",
        },
      ] as Parameters<
        typeof mapBuilderCmsEntriesToLocalItems
      >[0]["existingRows"],
    });

    expect(mapped.has("doc-established")).toBe(false);
  });

  it("allows a synthetic Builder fixture row to adopt a live identity", () => {
    const mapped = mapBuilderCmsEntriesToLocalItems({
      entries: [
        {
          id: "builder-live",
          model: "blog_article",
          title: "Fixture title",
          urlPath: "/blog/fixture-title",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
      ],
      items: [item("doc-fixture", "Fixture title")],
      sourceTable: "blog_article",
      now: "2026-06-08T13:00:00.000Z",
      existingRows: [
        {
          documentId: "doc-fixture",
          sourceRowId: "builder-doc-fixture",
          sourceQualifiedId: "builder-cms://blog_article/builder-doc-fixture",
          provenance: BUILDER_CMS_FIXTURE_ROW_PROVENANCE,
        },
      ] as Parameters<
        typeof mapBuilderCmsEntriesToLocalItems
      >[0]["existingRows"],
    });

    expect(mapped.get("doc-fixture")?.id).toBe("builder-live");
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

  it("preserves the authoritative hydrated body when an unchanged list read reports a different lightweight hash", () => {
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
            lastUpdated: "2026-06-08T13:00:00.000Z",
            [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "lightweight-list-hash",
          },
        },
        existingSourceValuesJson: JSON.stringify({
          lastUpdated: "2026-06-08T13:00:00.000Z",
          [BUILDER_CMS_BODY_LAST_UPDATED_KEY]: "2026-06-08T13:00:00.000Z",
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "authoritative-entry-hash",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated baseline",
          [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "Lossless baseline",
        }),
        existingLastSourceUpdatedAt: "2026-06-08T13:00:00.000Z",
      }),
    ).toMatchObject({
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "authoritative-entry-hash",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Readable hydrated baseline",
      [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: "Lossless baseline",
      [BUILDER_CMS_BODY_LAST_UPDATED_KEY]: "2026-06-08T13:00:00.000Z",
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
