import { describe, expect, it } from "vitest";

import { buildSearchIndex, loadDoc } from "./docs-content";

describe("docs content parsing", () => {
  it("uses Agent Resources as the canonical docs slug and search path", async () => {
    const doc = await loadDoc("agent-resources");
    const paths = (await buildSearchIndex()).map((entry) => entry.path);

    expect(doc?.title).toBe("Agent Resources");
    expect(doc?.body).not.toContain("Which workspace doc?");
    expect(await loadDoc("workspace")).toBeUndefined();
    expect(paths).toContain("/docs/agent-resources");
    expect(paths).not.toContain("/docs/workspace");
  }, 15_000);

  it("keeps headings after self-closing MDX components in the TOC", async () => {
    const doc = await loadDoc("recurring-jobs");

    expect(doc).toBeDefined();
    const ids = doc!.headings.map((h) => h.id);
    expect(ids).toContain("frontmatter");
  });

  it("ignores fenced markdown headings when extracting page headings", async () => {
    const doc = await loadDoc("creating-templates");

    expect(doc).toBeDefined();
    const headings = doc!.headings;
    const ids = headings.map((heading) => heading.id);

    expect(ids.filter((id) => id === "actions")).toHaveLength(1);
    expect(ids.filter((id) => id === "application-state")).toHaveLength(1);
    expect(headings.map((heading) => heading.label)).not.toContain(
      "Core Rules",
    );
  });

  it("keeps fenced markdown headings out of the search section index", async () => {
    const sections = (await buildSearchIndex()).filter(
      (entry) => entry.path === "/docs/creating-templates",
    );

    expect(sections.some((entry) => entry.section === "Actions")).toBe(false);
    expect(
      sections.some((entry) => entry.section === "Application State"),
    ).toBe(false);
  }, 15_000);

  it("indexes markdown mirror text instead of raw MDX component source", async () => {
    const indexText = (await buildSearchIndex())
      .map((entry) => `${entry.section}\n${entry.text}`)
      .join("\n");

    expect(indexText).not.toMatch(
      /<(?:AnnotatedCode|Callout|Checklist|Columns|DataModel|Diff|Endpoint|FileTree|JsonExplorer|OpenApiSpec|Table|Tabs|Wireframe)\b/,
    );
    expect(indexText).not.toContain("doc-block-");
    expect(indexText).not.toContain("params={[");
  }, 15_000);
});
