import { describe, expect, it } from "vitest";

import { buildSearchIndex, getDoc } from "./docs-content";

describe("docs content parsing", () => {
  it("uses Agent Resources as the canonical docs slug and search path", () => {
    const doc = getDoc("agent-resources");
    const paths = buildSearchIndex().map((entry) => entry.path);

    expect(doc?.title).toBe("Agent Resources");
    expect(doc?.body).not.toContain("Which workspace doc?");
    expect(getDoc("workspace")).toBeUndefined();
    expect(paths).toContain("/docs/agent-resources");
    expect(paths).not.toContain("/docs/workspace");
  });

  it("ignores fenced markdown headings when extracting page headings", () => {
    const doc = getDoc("creating-templates");

    expect(doc).toBeDefined();
    const headings = doc!.headings;
    const ids = headings.map((heading) => heading.id);

    expect(ids.filter((id) => id === "actions")).toHaveLength(1);
    expect(ids.filter((id) => id === "application-state")).toHaveLength(1);
    expect(headings.map((heading) => heading.label)).not.toContain(
      "Core Rules",
    );
  });

  it("keeps fenced markdown headings out of the search section index", () => {
    const sections = buildSearchIndex().filter(
      (entry) => entry.path === "/docs/creating-templates",
    );

    expect(sections.some((entry) => entry.section === "Actions")).toBe(false);
    expect(
      sections.some((entry) => entry.section === "Application State"),
    ).toBe(false);
  });

  it("indexes markdown mirror text instead of raw MDX component source", () => {
    const indexText = buildSearchIndex()
      .map((entry) => `${entry.section}\n${entry.text}`)
      .join("\n");

    expect(indexText).not.toMatch(
      /<(?:AnnotatedCode|Callout|Checklist|Columns|DataModel|Diff|Endpoint|FileTree|JsonExplorer|OpenApiSpec|Table|Tabs|Wireframe)\b/,
    );
    expect(indexText).not.toContain("doc-block-");
    expect(indexText).not.toContain("params={[");
  });
});
