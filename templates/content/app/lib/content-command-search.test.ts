import { describe, expect, it } from "vitest";

import {
  contentCommandDocumentPath,
  searchHighlightParts,
} from "./content-command-search";

describe("content command search", () => {
  it("preserves canonical page and local file routes", () => {
    expect(contentCommandDocumentPath("doc-1")).toBe("/page/doc-1");
    expect(contentCommandDocumentPath("local-file:docs/launch.md")).toBe(
      "/page/local-file:docs/launch.md",
    );
  });
  it("highlights literal repeated matches without interpreting markup or regex", () => {
    expect(searchHighlightParts("<b>A.b a.B</b>", ["a.b"])).toEqual([
      { text: "<b>", match: false },
      { text: "A.b", match: true },
      { text: " ", match: false },
      { text: "a.B", match: true },
      { text: "</b>", match: false },
    ]);
    expect(searchHighlightParts("No match", [" "])).toEqual([
      { text: "No match", match: false },
    ]);
    expect(searchHighlightParts("No match", ["needle"])).toEqual([
      { text: "No match", match: false },
    ]);
  });

  it("highlights every needle without overlapping matches", () => {
    expect(
      searchHighlightParts("status hub report", ["hub", "status"]),
    ).toEqual([
      { text: "status", match: true },
      { text: " ", match: false },
      { text: "hub", match: true },
      { text: " report", match: false },
    ]);
    expect(searchHighlightParts("Atlas note notes", ["note"])).toEqual([
      { text: "Atlas ", match: false },
      { text: "note", match: true },
      { text: " ", match: false },
      { text: "note", match: true },
      { text: "s", match: false },
    ]);
    expect(searchHighlightParts("QA4600", [])).toEqual([
      { text: "QA4600", match: false },
    ]);
    expect(
      searchHighlightParts("Status Status", ["Status Hub", "status"]),
    ).toEqual([
      { text: "Status", match: true },
      { text: " ", match: false },
      { text: "Status", match: true },
    ]);
  });
});
