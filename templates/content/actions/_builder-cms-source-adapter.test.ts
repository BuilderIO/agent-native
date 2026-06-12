import { describe, expect, it } from "vitest";
import type { ContentDatabaseItem } from "../shared/api";
import {
  buildBuilderCmsFixtureEntry,
  builderCmsQualifiedId,
  builderCmsSourceFieldKey,
  builderCmsSourceMetadata,
  builderCmsSourceRowIdentity,
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
        },
      }),
    ).toEqual({
      sourceRowId: "builder-live",
      sourceQualifiedId: "builder-cms://blog_article/builder-live",
      sourceDisplayKey: "Live Builder title",
      lastSourceUpdatedAt: "2026-06-08T12:00:00.000Z",
    });
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
    });
  });
});
