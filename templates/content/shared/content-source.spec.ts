import { describe, expect, it } from "vitest";

import {
  buildContentSourceBundle,
  contentSourcePathForDocument,
  isBuilderMdxSourcePath,
  isContentSourcePath,
  mergeContentSourceFiles,
  parseContentSourceFile,
  serializeContentSourceDocument,
  updateContentSourceFile,
} from "./content-source";
import { sameSourceMarkdown } from "./source-markdown";

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
      visibility: "private",
    });
  });

  it("rejects invalid visibility frontmatter", () => {
    expect(
      parseContentSourceFile(
        "content/pricing-page.mdx",
        '---\nid: "doc_1234"\nvisibility: "team"\n---\n\nBody',
      ),
    ).toMatchObject({
      visibility: undefined,
      errors: ["Invalid visibility frontmatter."],
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

  it("reads only top-level frontmatter keys", () => {
    expect(
      parseContentSourceFile(
        "content/pricing-page.mdx",
        "---\ntitle: Pricing\nseo:\n  title: Search title\n  icon: rocket\n---\n\nBody",
      ),
    ).toMatchObject({ title: "Pricing", icon: undefined });
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

describe("updateContentSourceFile", () => {
  const PATH = "notes/field-notes.md";
  const unchanged = {
    title: "Field Notes",
    description: "",
    icon: null,
    parentId: null,
    position: 2,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private" as const,
  };

  it("adds no frontmatter to a file that has none", () => {
    expect(
      updateContentSourceFile(PATH, "One\n\nTwo\n", {
        ...unchanged,
        content: "One\nThree",
      }),
    ).toBe("One\n\nThree\n");
  });

  it("keeps the header's own bytes when only the body changed", () => {
    const source =
      "---\r\n# written by hand\r\ntags: [a,  b]\r\ntitle:   'Field Notes'\r\n---\r\n\r\nOne\r\n";
    expect(
      updateContentSourceFile(PATH, source, { ...unchanged, content: "Two" }),
    ).toBe(source.replace("One", "Two"));
  });

  it("writes a changed title in the line it already has", () => {
    expect(
      updateContentSourceFile(
        PATH,
        "---\ntitle: Field notes\ntags: [a]\n---\nOne\n",
        { ...unchanged, title: "Trip notes", content: "One" },
      ),
    ).toBe("---\ntitle: Trip notes\ntags: [a]\n---\nOne\n");
  });

  it("quotes a changed title that plain YAML can't hold", () => {
    expect(
      updateContentSourceFile(PATH, "---\ntitle: Field notes\n---\n\nOne\n", {
        ...unchanged,
        title: "Notes: the trip",
        content: "One",
      }),
    ).toBe('---\ntitle: "Notes: the trip"\n---\n\nOne\n');
  });

  it("replaces a value that continues on the lines below it", () => {
    expect(
      updateContentSourceFile(
        PATH,
        "---\ndescription: >\n  first\n  second\ntags:\n  - a\n---\n\nOne\n",
        { ...unchanged, description: "Short", content: "One" },
      ),
    ).toBe('---\ndescription: "Short"\ntags:\n  - a\n---\n\nOne\n');
  });

  it("adds a header only for what the file can't already say", () => {
    expect(
      updateContentSourceFile(PATH, "One\n", {
        ...unchanged,
        title: "Trip notes",
        content: "One",
      }),
    ).toBe('---\ntitle: "Trip notes"\n---\n\nOne\n');
    expect(
      updateContentSourceFile(PATH, "One\n", {
        ...unchanged,
        isFavorite: true,
        hideFromSearch: true,
        visibility: "org",
        content: "One",
      }),
    ).toBe("One\n");
  });

  it("keeps a body that looks like frontmatter out of the header", () => {
    const content = "---\nnot: a header\n---\nBody";
    const saved = updateContentSourceFile(PATH, "Old body\n", {
      ...unchanged,
      content,
    });
    const reread = parseContentSourceFile(PATH, saved);
    expect(sameSourceMarkdown(reread.content, content)).toBe(true);
    expect(
      updateContentSourceFile(PATH, saved, { ...unchanged, content }),
    ).toBe(saved);
  });

  it("writes a changed title where an indented header keeps its keys", () => {
    const source =
      "---\n  # mine\n  title: Field notes\n  nested:\n    title: other\n---\n\nOne\n";
    const saved = updateContentSourceFile(PATH, source, {
      ...unchanged,
      title: "Trip notes",
      description: "Short",
      content: "One",
    });
    expect(saved).toBe(
      '---\n  # mine\n  title: Trip notes\n  nested:\n    title: other\n  description: "Short"\n---\n\nOne\n',
    );
    expect(parseContentSourceFile(PATH, saved)).toMatchObject({
      title: "Trip notes",
      description: "Short",
    });
  });

  it("keeps the comments and blank lines below a value it changes", () => {
    const title = (value: string) =>
      "---\ntitle: " +
      value +
      "\n  # why this title\n\ntags: [a]\n---\n\nOne\n";
    expect(
      updateContentSourceFile(PATH, title("Field notes"), {
        ...unchanged,
        title: "Trip notes",
        content: "One",
      }),
    ).toBe(title("Trip notes"));
    expect(
      updateContentSourceFile(
        PATH,
        "---\ndescription: |\n  # part of the text\n\n  more\n\ntags: [a]\n---\n\nOne\n",
        { ...unchanged, description: "Short", content: "One" },
      ),
    ).toBe('---\ndescription: "Short"\n\ntags: [a]\n---\n\nOne\n');
  });

  it("keeps each header line's own ending", () => {
    expect(
      updateContentSourceFile(
        PATH,
        "---\r\ntitle: Field notes\ntags: [a]\r\nmore: b\n---\r\n\r\nOne\r\n",
        { ...unchanged, title: "Trip notes", content: "One" },
      ),
    ).toBe(
      "---\r\ntitle: Trip notes\ntags: [a]\r\nmore: b\n---\r\n\r\nOne\r\n",
    );
  });

  it("leaves what the edit doesn't give", () => {
    const source =
      '---\ntitle: Field Notes\ndescription: Outside\nicon: "🌿"\nposition: 9\nisFavorite: true\n---\n\nOne\n';
    expect(
      updateContentSourceFile(PATH, source, {
        title: "Field Notes",
        content: "Two",
      }),
    ).toBe(source.replace("One", "Two"));
  });

  it("updates the Content settings the file records", () => {
    expect(
      updateContentSourceFile(
        PATH,
        "---\nposition: 4\nisFavorite: false\nvisibility: private\nupdatedAt: 2024-05-01\n---\n\nOne\n",
        { ...unchanged, isFavorite: true, visibility: "org", content: "One" },
      ),
    ).toBe(
      "---\nposition: 2\nisFavorite: true\nvisibility: org\nupdatedAt: 2024-05-01\n---\n\nOne\n",
    );
  });
});

describe("mergeContentSourceFiles", () => {
  const exported = serializeContentSourceDocument({
    id: "doc_1234",
    parentId: null,
    title: "Field Notes",
    content: "# Field notes\n- one\n- two",
    description: "",
    icon: null,
    position: 3,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
  });

  it("leaves a file alone when its page says the same thing", () => {
    const source = "# Field notes\n\n* one\n* two\n";
    expect(
      mergeContentSourceFiles(
        { "field-notes.md": source },
        { "field-notes.md": exported },
      ),
    ).toEqual({ "field-notes.md": source });
  });

  it("writes a page whose file is gone as it was exported", () => {
    expect(mergeContentSourceFiles({}, { "field-notes.md": exported })).toEqual(
      { "field-notes.md": exported },
    );
  });
});
