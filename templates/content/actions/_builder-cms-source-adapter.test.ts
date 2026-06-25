import { describe, expect, it } from "vitest";

import type { ContentDatabaseItem } from "../shared/api";
import {
  buildBuilderCmsFixtureEntry,
  builderCmsQualifiedId,
  builderCmsSourceFieldKey,
  builderCmsSourceMetadata,
  builderCmsSourceRowIdentity,
  builderCmsSourceRowIdentityState,
  builderCmsSyntheticFixtureEntryId,
  normalizeBuilderCmsApiEntry,
} from "./_builder-cms-source-adapter";

function item(title: string): ContentDatabaseItem {
  return {
    id: "item-1",
    databaseId: "database-1",
    position: 0,
    document: {
      id: "DocA",
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

describe("Builder CMS source adapter", () => {
  it("normalizes a local row into a Builder-shaped fixture entry", () => {
    expect(
      buildBuilderCmsFixtureEntry({
        item: item("Hello Builder CMS"),
        sourceTable: "blog_article",
        now: "2026-06-08T12:00:00.000Z",
      }),
    ).toEqual({
      id: "builder-DocA",
      model: "blog_article",
      title: "Hello Builder CMS",
      urlPath: "/blog/hello-builder-cms",
      updatedAt: "2026-06-08T12:00:00.000Z",
      sourceValues: {
        "data.title": "Hello Builder CMS",
        "data.url": "/blog/hello-builder-cms",
        lastUpdated: "2026-06-08T12:00:00.000Z",
      },
    });
  });

  it("uses Builder field keys for title, URL, and user properties", () => {
    expect(builderCmsSourceFieldKey("title", "Title")).toBe("data.title");
    expect(builderCmsSourceFieldKey("builder_url", "Builder URL")).toBe(
      "data.url",
    );
    expect(builderCmsSourceFieldKey("prop-1", "SEO Title")).toBe(
      "data.seo_title",
    );
  });

  it("records Builder metadata with natural key and autosave push mode", () => {
    expect(builderCmsSourceMetadata("blog_article")).toMatchObject({
      primaryKey: "id",
      titleField: "data.title",
      naturalKeyField: "/blog/[slug]",
      pushMode: "autosave",
      label: "builder.cms.blog_article",
    });
  });

  it("preserves existing Builder row identity across local refreshes", () => {
    expect(
      builderCmsSourceRowIdentity({
        item: item("Locally edited title"),
        sourceTable: "blog_article",
        now: "2026-06-08T12:30:00.000Z",
        existing: {
          documentId: "DocA",
          sourceRowId: "builder-remote-1",
          sourceQualifiedId: builderCmsQualifiedId({
            sourceTable: "blog_article",
            entryId: "builder-remote-1",
          }),
          sourceDisplayKey: "Original Builder title",
          lastSourceUpdatedAt: "2026-06-08T12:00:00.000Z",
        },
      }),
    ).toEqual({
      sourceRowId: "builder-remote-1",
      sourceQualifiedId: "builder-cms://blog_article/builder-remote-1",
      sourceDisplayKey: "Original Builder title",
      lastSourceUpdatedAt: "2026-06-08T12:00:00.000Z",
    });
  });

  it("uses live Builder entries ahead of local fixture identity", () => {
    expect(
      builderCmsSourceRowIdentity({
        item: item("Locally edited title"),
        sourceTable: "blog_article",
        now: "2026-06-08T12:30:00.000Z",
        existing: {
          documentId: "DocA",
          sourceRowId: "builder-old",
          sourceQualifiedId: "builder-cms://blog_article/builder-old",
          sourceDisplayKey: "Old title",
          lastSourceUpdatedAt: "2026-06-08T11:00:00.000Z",
        },
        entry: {
          id: "builder-live",
          model: "blog_article",
          title: "Live Builder title",
          urlPath: "/blog/live-builder-title",
          updatedAt: "2026-06-08T12:00:00.000Z",
          sourceValues: {
            "data.title": "Live Builder title",
            "data.url": "/blog/live-builder-title",
            lastUpdated: "2026-06-08T12:00:00.000Z",
          },
        },
      }),
    ).toEqual({
      sourceRowId: "builder-live",
      sourceQualifiedId: "builder-cms://blog_article/builder-live",
      sourceDisplayKey: "Live Builder title",
      lastSourceUpdatedAt: "2026-06-08T12:00:00.000Z",
    });
  });

  it("detects legacy fixture-wrapped Builder IDs without treating them as write targets", () => {
    const row = {
      documentId: "BU5P0mT9anul",
      sourceRowId: "builder-BU5P0mT9anul",
      sourceQualifiedId:
        "builder-cms://agent-native-blog-article-test/builder-BU5P0mT9anul",
      provenance: "Builder CMS fixture adapter",
    };

    expect(
      builderCmsSyntheticFixtureEntryId({
        sourceRowId: row.sourceRowId,
        documentId: row.documentId,
        provenance: row.provenance,
      }),
    ).toBe("BU5P0mT9anul");
    expect(
      builderCmsSourceRowIdentityState({
        row,
      }),
    ).toEqual({
      sourceRowId: "builder-BU5P0mT9anul",
      sourceQualifiedId:
        "builder-cms://agent-native-blog-article-test/builder-BU5P0mT9anul",
      syntheticFixtureEntryId: "BU5P0mT9anul",
      isSyntheticFixture: true,
    });
  });

  it("does not strip builder-prefixed IDs from non-fixture rows", () => {
    expect(
      builderCmsSyntheticFixtureEntryId({
        sourceRowId: "builder-BU5P0mT9anul",
        documentId: "BU5P0mT9anul",
        provenance: "Builder CMS read adapter",
      }),
    ).toBeNull();
  });

  it("normalizes Builder Content API entries", () => {
    expect(
      normalizeBuilderCmsApiEntry(
        {
          id: "entry-1",
          name: "Fallback name",
          lastUpdated: "2026-06-08T12:00:00.000Z",
          data: {
            title: "Builder API title",
            url: "/blog/builder-api-title",
            handle: "builder-api-title",
            description: "A useful field",
          },
        },
        "blog_article",
      ),
    ).toEqual({
      id: "entry-1",
      model: "blog_article",
      title: "Builder API title",
      urlPath: "/blog/builder-api-title",
      updatedAt: "2026-06-08T12:00:00.000Z",
      sourceValues: {
        "data.title": "Builder API title",
        "data.url": "/blog/builder-api-title",
        "data.handle": "builder-api-title",
        "data.description": "A useful field",
        lastUpdated: "2026-06-08T12:00:00.000Z",
      },
    });
  });

  it("renders Builder reference fields as readable labels, not raw JSON", () => {
    const result = normalizeBuilderCmsApiEntry(
      {
        id: "entry-ref",
        lastUpdated: "2026-06-16T12:00:00.000Z",
        data: {
          title: "Has an author reference",
          author: {
            "@type": "@builder.io/core:Reference",
            id: "724dd11feeb549f0b6fc12b6e4741c19",
            model: "blog-author",
          },
          coAuthor: {
            "@type": "@builder.io/core:Reference",
            id: "abc12345",
            model: "blog-author",
            value: { data: { name: "Ada Lovelace" } },
          },
          editor: {
            "@type": "@builder.io/core:Reference",
            id: "def67890",
            model: "blog-author",
            value: { name: "Grace Hopper", data: {} },
          },
        },
      },
      "blog-article",
    );
    // Bare reference → readable model:shortId token, never raw reference JSON.
    expect(result?.sourceValues["data.author"]).toBe("blog-author:724dd11f");
    expect(String(result?.sourceValues["data.author"])).not.toContain(
      "@builder.io/core:Reference",
    );
    // Inlined reference value → use the referenced entry's human name,
    // whether it lives in `value.data` or at the enriched entry's top level.
    expect(result?.sourceValues["data.coAuthor"]).toBe("Ada Lovelace");
    expect(result?.sourceValues["data.editor"]).toBe("Grace Hopper");
  });
});
