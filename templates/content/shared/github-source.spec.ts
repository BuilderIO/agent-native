import { describe, expect, it } from "vitest";

import {
  classifyGitHubSourceFile,
  fitsGitHubFieldType,
  githubBranchCandidates,
  githubFieldPropertyInput,
  githubFileWebUrl,
  githubFolderLabel,
  githubFolderWebUrl,
  githubSourceTable,
  inferGitHubFieldType,
  parseGitHubFolderUrl,
  parseGitHubSourceTable,
} from "./github-source";

describe("parseGitHubFolderUrl", () => {
  it("reads a folder URL with its branch and folder segments", () => {
    expect(
      parseGitHubFolderUrl(
        "https://github.com/acme/docs-site/tree/main/content/guides/",
      ),
    ).toEqual({
      ok: true,
      owner: "acme",
      repo: "docs-site",
      refPath: ["main", "content", "guides"],
    });
  });

  it("reads a repository URL, a URL without a scheme, and the shorthand", () => {
    for (const input of [
      "https://github.com/acme/docs-site",
      "github.com/acme/docs-site.git",
      "acme/docs-site",
      "  https://www.github.com/acme/docs-site?tab=readme#top ",
    ]) {
      expect(parseGitHubFolderUrl(input)).toEqual({
        ok: true,
        owner: "acme",
        repo: "docs-site",
        refPath: [],
      });
    }
    expect(parseGitHubFolderUrl("acme/docs-site/tree/dev/docs")).toMatchObject({
      ok: true,
      refPath: ["dev", "docs"],
    });
  });

  it("decodes encoded folder names", () => {
    expect(
      parseGitHubFolderUrl(
        "https://github.com/acme/site/tree/main/Getting%20Started",
      ),
    ).toMatchObject({ ok: true, refPath: ["main", "Getting Started"] });
  });

  it("refuses file URLs, other hosts and malformed paths with a reason", () => {
    expect(
      parseGitHubFolderUrl("https://github.com/acme/site/blob/main/docs/a.md"),
    ).toEqual({ ok: false, reason: "file" });
    expect(parseGitHubFolderUrl("https://gitlab.com/acme/site")).toEqual({
      ok: false,
      reason: "not-github",
    });
    for (const input of [
      "",
      "https://github.com/acme",
      "https://github.com/acme/site/pulls",
      "https://github.com/acme/site/tree",
      "https://github.com/-bad/site",
      "https://github.com/acme/site/tree/main/%E0%A4%A",
    ]) {
      expect(parseGitHubFolderUrl(input)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
});

describe("githubBranchCandidates", () => {
  it("tries the shortest branch first and keeps slashes in longer ones", () => {
    expect(githubBranchCandidates(["release", "2026", "docs"])).toEqual([
      { branch: "release", path: "2026/docs" },
      { branch: "release/2026", path: "docs" },
      { branch: "release/2026/docs", path: "" },
    ]);
    expect(githubBranchCandidates([])).toEqual([]);
    expect(githubBranchCandidates(["a", "b", "c"], 2)).toHaveLength(2);
  });
});

describe("source table identity", () => {
  it("round-trips a folder location, including a branch with slashes", () => {
    const location = {
      owner: "acme",
      repo: "docs-site",
      branch: "release/2026",
      path: "content/guides",
    };
    const table = githubSourceTable(location);
    expect(table).toBe("acme/docs-site@release/2026:content/guides");
    expect(parseGitHubSourceTable(table)).toEqual(location);
    expect(
      parseGitHubSourceTable(githubSourceTable({ ...location, path: "/" })),
    ).toEqual({ ...location, path: "" });
    expect(parseGitHubSourceTable("not a table")).toBeNull();
  });

  it("builds web URLs and labels", () => {
    const location = {
      owner: "acme",
      repo: "site",
      branch: "main",
      path: "docs",
    };
    expect(githubFolderWebUrl(location)).toBe(
      "https://github.com/acme/site/tree/main/docs",
    );
    expect(githubFolderWebUrl({ ...location, path: "" })).toBe(
      "https://github.com/acme/site/tree/main",
    );
    expect(githubFileWebUrl(location, "docs/Getting Started.md")).toBe(
      "https://github.com/acme/site/blob/main/docs/Getting%20Started.md",
    );
    expect(githubFolderLabel(location)).toBe("acme/site/docs");
    expect(githubFolderLabel({ ...location, path: "" })).toBe("acme/site");
  });
});

describe("classifyGitHubSourceFile", () => {
  it("makes Markdown files rows and skips MDX and oversized files", () => {
    expect(classifyGitHubSourceFile("guide.md", 10)).toEqual({
      kind: "markdown",
    });
    expect(classifyGitHubSourceFile("nested/Notes.MARKDOWN", null)).toEqual({
      kind: "markdown",
    });
    expect(classifyGitHubSourceFile("demo.mdx", 10)).toEqual({
      kind: "skipped",
      reason: "mdx",
    });
    expect(classifyGitHubSourceFile("huge.md", 2 * 1024 * 1024)).toEqual({
      kind: "skipped",
      reason: "too-large",
    });
  });

  it("ignores hidden folders, dependencies and non-Markdown files", () => {
    for (const path of [
      ".github/pull_request_template.md",
      "drafts/.hidden.md",
      "node_modules/pkg/README.md",
      "images/diagram.png",
      "data.json",
    ]) {
      expect(classifyGitHubSourceFile(path, 10)).toEqual({ kind: "ignored" });
    }
  });
});

describe("inferGitHubFieldType", () => {
  it("keeps the kind of plain values", () => {
    expect(inferGitHubFieldType("featured", [true, false])).toBe("checkbox");
    expect(inferGitHubFieldType("order", [1, 2.5])).toBe("number");
    expect(
      inferGitHubFieldType("published", ["2026-09-01", "2026-09-02T10:00:00Z"]),
    ).toBe("date");
    expect(inferGitHubFieldType("canonical", ["https://example.com/a"])).toBe(
      "url",
    );
    expect(inferGitHubFieldType("summary", ["Short text"])).toBe("text");
  });

  it("makes tag lists multi-select, even with a lone string among them", () => {
    expect(inferGitHubFieldType("tags", [["guide", "intro"], ["faq"]])).toBe(
      "multi_select",
    );
    expect(inferGitHubFieldType("tags", [["guide"], "faq"])).toBe(
      "multi_select",
    );
  });

  it("makes short labels under status-like keys a select", () => {
    expect(inferGitHubFieldType("status", ["Draft", "Published"])).toBe(
      "select",
    );
    expect(inferGitHubFieldType("Category", ["Guides"])).toBe("select");
    expect(inferGitHubFieldType("author", ["Ada"])).toBe("text");
  });

  it("falls back to text for mixed or nested values and ignores empties", () => {
    expect(inferGitHubFieldType("order", [1, "two"])).toBe("text");
    expect(inferGitHubFieldType("meta", [{ a: 1 }])).toBe("text");
    expect(inferGitHubFieldType("featured", [null, "", true])).toBe("checkbox");
    expect(inferGitHubFieldType("anything", [])).toBe("text");
  });
});

describe("field values", () => {
  it("checks whether a value fits a column type", () => {
    expect(fitsGitHubFieldType("number", 3)).toBe(true);
    expect(fitsGitHubFieldType("number", "3")).toBe(false);
    expect(fitsGitHubFieldType("checkbox", "yes")).toBe(false);
    expect(fitsGitHubFieldType("date", "2026-13-45")).toBe(false);
    expect(fitsGitHubFieldType("multi_select", "solo")).toBe(true);
    expect(fitsGitHubFieldType("select", null)).toBe(true);
  });

  it("prepares values for Content's property normalizer", () => {
    expect(githubFieldPropertyInput("multi_select", "solo")).toEqual(["solo"]);
    expect(githubFieldPropertyInput("text", { a: 1 })).toBe('{"a":1}');
    expect(githubFieldPropertyInput("text", 4)).toBe("4");
    expect(githubFieldPropertyInput("number", 4)).toBe(4);
    expect(githubFieldPropertyInput("date", null)).toBeNull();
  });
});
