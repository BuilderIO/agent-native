import { describe, expect, it } from "vitest";

import {
  buildContentSourceBundle,
  contentSourcePathForDocument,
  isBuilderMdxSourcePath,
  isContentSourcePath,
  parseContentSourceFile,
  serializeContentSourceDocument,
} from "./content-source";

describe("content source files", () => {
  it("serializes documents as frontmatter plus markdown body", () => {
    const source = serializeContentSourceDocument({
      id: "doc_1234",
      parentId: "parent_1234",
      title: "Launch Plan",
      content: "## Goals\n\nShip the thing.",
      icon: "rocket",
      position: 2,
      isFavorite: true,
      hideFromSearch: false,
      visibility: "private",
      updatedAt: "2026-06-11T12:00:00.000Z",
    });

    expect(source).toContain('id: "doc_1234"');
    expect(source).toContain('title: "Launch Plan"');
    expect(source).toContain("isFavorite: true");
    expect(source.endsWith("## Goals\n\nShip the thing.")).toBe(true);
  });

  it("parses exported source without adding a leading blank line", () => {
    const source = serializeContentSourceDocument({
      id: "doc_1234",
      parentId: null,
      title: "Launch Plan",
      content: "First line\n\nSecond line",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
    });

    expect(
      parseContentSourceFile("content/launch-plan--doc_1234.mdx", source),
    ).toMatchObject({
      id: "doc_1234",
      parentId: null,
      title: "Launch Plan",
      content: "First line\n\nSecond line",
    });
  });

  it("falls back to the filename when a file has no frontmatter", () => {
    expect(
      parseContentSourceFile("content/pricing-page.mdx", "# Pricing"),
    ).toMatchObject({
      id: undefined,
      title: "Pricing Page",
      content: "# Pricing",
    });
  });

  it("leaves optional metadata undefined when omitted from frontmatter", () => {
    expect(
      parseContentSourceFile(
        "content/pricing-page.mdx",
        '---\nid: "doc_1234"\ntitle: "Pricing"\n---\n\nBody',
      ),
    ).toMatchObject({
      id: "doc_1234",
      title: "Pricing",
      parentId: undefined,
      icon: undefined,
    });
  });

  it("reports invalid parent frontmatter instead of reparenting", () => {
    expect(
      parseContentSourceFile(
        "content/pricing-page.mdx",
        '---\nid: "doc_1234"\ntitle: "Pricing"\nparentId: "bad id"\n---\n\nBody',
      ),
    ).toMatchObject({
      id: "doc_1234",
      parentId: undefined,
      errors: ["Invalid parentId frontmatter."],
    });
  });

  it("builds a deterministic content bundle path per document", () => {
    const doc = {
      id: "abc123",
      parentId: null,
      title: "Hello, World!",
      content: "Body",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private" as const,
    };

    const bundle = buildContentSourceBundle([doc]);

    expect(contentSourcePathForDocument(doc)).toBe(
      "content/hello-world--abc123.mdx",
    );
    expect(Object.keys(bundle.files)).toEqual([
      "content/hello-world--abc123.mdx",
    ]);
  });

  it("reserves Builder MDX files for Builder-specific actions", () => {
    expect(
      isBuilderMdxSourcePath("content/builder/docs/intro.builder.mdx"),
    ).toBe(true);
    expect(isContentSourcePath("content/builder/docs/intro.builder.mdx")).toBe(
      false,
    );
    expect(isContentSourcePath("content/plain.mdx")).toBe(true);
  });
});
