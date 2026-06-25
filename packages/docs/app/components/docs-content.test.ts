import { describe, expect, it } from "vitest";

import { buildSearchIndex, getDoc } from "./docs-content";

describe("docs content parsing", () => {
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
});
