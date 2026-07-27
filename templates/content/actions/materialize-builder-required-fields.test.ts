import { describe, expect, it, vi } from "vitest";

import {
  buildBuilderLocalOutboundChangeSets,
  builderReferenceIdSourceValueKey,
} from "./_database-source-utils.js";
import {
  isRequiredEditableBuilderField,
  isBuilderReferenceModelField,
  propertyTypeForRequiredBuilderField,
  readBuilderReferenceSnapshot,
  referenceItemValues,
} from "./materialize-builder-required-fields.js";

describe("safe Builder required-field materialization", () => {
  it("selects required metadata fields while leaving title and body on their dedicated paths", () => {
    const fields = [
      { name: "title", type: "text", required: true },
      { name: "blocks", type: "uiBlocks", required: true },
      { name: "handle", type: "text", required: true },
      { name: "metaTitle", type: "text", required: false },
    ];

    expect(fields.filter(isRequiredEditableBuilderField)).toEqual([
      { name: "handle", type: "text", required: true },
    ]);
  });

  it("uses Content-native editors for Builder reference and file fields", () => {
    expect(
      propertyTypeForRequiredBuilderField(
        { sourceFieldType: "reference" } as never,
        { name: "author", type: "reference", required: true },
      ),
    ).toBe("select");
    expect(
      propertyTypeForRequiredBuilderField(
        { sourceFieldType: "select" } as never,
        { name: "author", type: "reference", required: true },
      ),
    ).toBe("select");
    expect(
      isBuilderReferenceModelField({
        name: "author",
        type: "reference",
        required: true,
      }),
    ).toBe(true);
    expect(
      propertyTypeForRequiredBuilderField(
        { sourceFieldType: "file" } as never,
        { name: "image", type: "file", required: true },
      ),
    ).toBe("files_media");
    expect(
      propertyTypeForRequiredBuilderField(
        { sourceFieldType: "list" } as never,
        {
          name: "tags",
          type: "list",
          inputType: "tags",
          required: true,
        },
      ),
    ).toBe("multi_select");
  });

  it("builds unambiguous author choices from an exhaustive safe-model reference read", async () => {
    const readEntries = vi.fn(async () => ({
      state: "live" as const,
      entries: [
        {
          id: "article-1",
          sourceValues: { "data.author": "Apoorva" },
          rawEntry: {
            data: {
              author: {
                "@type": "@builder.io/core:Reference",
                id: "author-1",
                model: "author",
              },
            },
          },
        },
        {
          id: "article-2",
          sourceValues: { "data.author": "Apoorva" },
          rawEntry: {
            data: {
              author: {
                "@type": "@builder.io/core:Reference",
                id: "author-2",
                model: "author",
              },
            },
          },
        },
      ],
      progress: { partial: false, hasMore: false },
    }));

    const snapshot = await readBuilderReferenceSnapshot({
      sourceTable: "agent-native-blog-article-test",
      field: {
        name: "author",
        label: "Author",
        type: "reference",
        model: "author",
        required: true,
      },
      readEntries: readEntries as never,
    });

    expect(readEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "agent-native-blog-article-test",
        fieldPaths: ["data.author"],
        rawData: true,
        requirePrivateKey: true,
      }),
    );
    expect(snapshot.bySourceRowId.get("article-1")).toMatchObject({
      id: "author-1",
      model: "author",
      label: "Apoorva",
    });
    expect(snapshot.model).toBe("author");
    expect(snapshot.options.options).toEqual([
      expect.objectContaining({
        id: "author-1",
        name: "Apoorva · author-1",
      }),
      expect.objectContaining({
        id: "author-2",
        name: "Apoorva · author-2",
      }),
    ]);
  });

  it("fails closed when the author reference inventory is incomplete", async () => {
    await expect(
      readBuilderReferenceSnapshot({
        sourceTable: "agent-native-blog-article-test",
        field: {
          name: "author",
          type: "reference",
          model: "author",
          required: true,
        },
        readEntries: vi.fn(async () => ({
          state: "live",
          entries: [],
          progress: { partial: true, hasMore: true },
        })) as never,
      }),
    ).rejects.toThrow("could not be read exhaustively");
  });

  it("repairs an already-materialized fallback label without overwriting an explicit edit", async () => {
    const snapshot = await readBuilderReferenceSnapshot({
      sourceTable: "agent-native-blog-article-test",
      field: {
        name: "author",
        label: "Author",
        type: "reference",
        model: "blog-author",
        required: true,
      },
      visibleValueBySourceRowId: new Map([
        ["article-ai-shell", "Steve Sewell"],
        ["article-quiet-comet", "Alice Moore"],
      ]),
      readEntries: vi.fn(async () => ({
        state: "live" as const,
        entries: [
          {
            id: "article-ai-shell",
            sourceValues: {
              "data.author": "blog-author:e5984d61",
            },
            rawEntry: {
              data: {
                author: {
                  "@type": "@builder.io/core:Reference",
                  id: "author-steve",
                  model: "blog-author",
                },
              },
            },
          },
          {
            id: "article-quiet-comet",
            sourceValues: {
              "data.author": "blog-author:quiet",
            },
            rawEntry: {
              data: {
                author: {
                  "@type": "@builder.io/core:Reference",
                  id: "author-alice",
                  model: "blog-author",
                },
              },
            },
          },
        ],
        progress: { partial: false, hasMore: false },
      })) as never,
    });
    expect(snapshot.options.options).toEqual([
      expect.objectContaining({ id: "author-alice", name: "Alice Moore" }),
      expect.objectContaining({ id: "author-steve", name: "Steve Sewell" }),
    ]);

    const rowRows = Array.from({ length: 171 }, (_, index) => ({
      id: `row-${index}`,
      databaseItemId: `item-${index}`,
      documentId: index === 170 ? "doc-quiet-comet" : `doc-${index}`,
      sourceDisplayKey: index === 170 ? "Quiet Comet" : `Article ${index}`,
      sourceValuesJson: JSON.stringify({
        "data.author": "Steve Sewell",
      }),
    }));
    const localValuesByDocument = new Map(
      rowRows.map((row) => [
        row.documentId,
        new Map([["prop-author", "author-steve"]]),
      ]),
    );
    const baseArgs = {
      source: { sourceType: "builder-cms" },
      rowRows,
      documentTitleById: new Map(
        rowRows.map((row) => [row.documentId, row.sourceDisplayKey]),
      ),
      storedChangeSets: [],
      writableFields: [
        {
          propertyId: "prop-author",
          localFieldKey: "prop-author",
          sourceFieldKey: "data.author",
          sourceFieldLabel: "Author",
          propertyType: "select",
          propertyOptions: snapshot.options,
          sourceFieldType: "reference",
          sourceFieldModel: "blog-author",
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0];

    const beforeRepair = buildBuilderLocalOutboundChangeSets({
      ...baseArgs,
      writableFields: [
        {
          ...baseArgs.writableFields![0]!,
          propertyOptions: {
            options: snapshot.options.options.map((option) => ({
              ...option,
              name: `blog-author:${option.id.slice(0, 8)}`,
            })),
          },
        },
      ],
      localValuesByDocument,
    });
    expect(beforeRepair).toHaveLength(171);

    const afterMaterialization = buildBuilderLocalOutboundChangeSets({
      ...baseArgs,
      localValuesByDocument,
    });
    expect(afterMaterialization).toEqual([]);

    const explicitlyEditedValues = new Map(localValuesByDocument);
    explicitlyEditedValues.set(
      "doc-quiet-comet",
      new Map([["prop-author", "author-alice"]]),
    );
    const afterExplicitEdit = buildBuilderLocalOutboundChangeSets({
      ...baseArgs,
      localValuesByDocument: explicitlyEditedValues,
    });
    expect(afterExplicitEdit).toHaveLength(1);
    expect(afterExplicitEdit[0]?.documentId).toBe("doc-quiet-comet");
    expect(afterExplicitEdit[0]?.fieldChanges).toMatchObject([
      {
        currentValue: "author-steve",
        proposedValue: "Alice Moore",
        builderValueJson: JSON.stringify({
          "@type": "@builder.io/core:Reference",
          id: "author-alice",
          model: "blog-author",
        }),
      },
    ]);

    expect(
      referenceItemValues({
        rows: [
          {
            sourceRowId: "article-ai-shell",
            databaseItemId: "item-ai-shell",
            documentId: "doc-ai-shell",
          },
          {
            sourceRowId: "article-quiet-comet",
            databaseItemId: "item-quiet-comet",
            documentId: "doc-quiet-comet",
          },
        ] as never,
        snapshot,
        // Quiet Comet's existing value may be a human edit. The idempotent
        // repair seeds AI Shell's missing value but leaves Quiet Comet alone.
        existingDocumentIds: new Set(["doc-quiet-comet"]),
      }),
    ).toEqual([
      {
        itemId: "item-ai-shell",
        documentId: "doc-ai-shell",
        value: "author-steve",
      },
    ]);
  });

  it("compares duplicate-label references by the canonical id stored for that source row", () => {
    const referenceIdKey = builderReferenceIdSourceValueKey("data.author");
    const baseArgs = {
      source: { sourceType: "builder-cms" },
      rowRows: [
        {
          id: "row-qwik",
          databaseItemId: "item-qwik",
          documentId: "doc-qwik",
          sourceDisplayKey: "Towards Qwik 2.0",
          sourceValuesJson: JSON.stringify({
            "data.author": "The Qwik Team",
            [referenceIdKey]: "author-qwik-primary",
          }),
        },
      ],
      documentTitleById: new Map([["doc-qwik", "Towards Qwik 2.0"]]),
      storedChangeSets: [],
      writableFields: [
        {
          propertyId: "prop-author",
          localFieldKey: "prop-author",
          sourceFieldKey: "data.author",
          sourceFieldLabel: "Author",
          propertyType: "select",
          sourceFieldType: "reference",
          sourceFieldModel: "blog-author",
          propertyOptions: {
            options: [
              {
                id: "author-qwik-primary",
                name: "The Qwik Team · author-q",
                color: "blue",
              },
              {
                id: "author-qwik-other",
                name: "The Qwik Team · other-au",
                color: "green",
              },
            ],
          },
        },
      ],
    } as Parameters<typeof buildBuilderLocalOutboundChangeSets>[0];

    expect(
      buildBuilderLocalOutboundChangeSets({
        ...baseArgs,
        localValuesByDocument: new Map([
          ["doc-qwik", new Map([["prop-author", "author-qwik-primary"]])],
        ]),
      }),
    ).toEqual([]);

    const [explicitEdit] = buildBuilderLocalOutboundChangeSets({
      ...baseArgs,
      localValuesByDocument: new Map([
        ["doc-qwik", new Map([["prop-author", "author-qwik-other"]])],
      ]),
    });
    expect(explicitEdit?.fieldChanges).toMatchObject([
      {
        currentValue: "The Qwik Team",
        proposedValue: "The Qwik Team · other-au",
      },
    ]);
  });
});
