import { describe, expect, it } from "vitest";
import type { ContentDatabaseItem, DocumentProperty } from "../shared/api";
import {
  buildBuilderLocalOutboundChangeSets,
  builderCmsEntryAlreadyRepresented,
  buildMockBodyChange,
  buildMockFieldChange,
  mapBuilderCmsEntriesToLocalItems,
  mockProposedValue,
  normalizeSourceFederation,
  normalizeSourceFreshness,
  sourceValuesForSeededSourceRow,
  sourceChangeSetKey,
  sourceChangeSetSummary,
} from "./_database-source-utils";

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
  it("normalizes freshness safely", () => {
    expect(normalizeSourceFreshness("fresh")).toBe("fresh");
    expect(normalizeSourceFreshness("stale")).toBe("stale");
    expect(normalizeSourceFreshness("mysterious fog")).toBe("unknown");
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
